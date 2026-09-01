import { WebSocket, WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'

// ============================================================================
// 生产环境配置（全部通过环境变量）
// ============================================================================
const host = process.env.HOST ?? '0.0.0.0'
const port = Number.parseInt(process.env.PORT ?? '1234', 10)
// 后端 service-collab 地址，用于票据验证（直接调用，不走网关）
const COLLAB_BACKEND_URL = (
  process.env.COLLAB_BACKEND_URL ?? 'https://electrokinetic-shawanna-unstrewn.ngrok-free.dev'
).replace(/\/+$/, '')
// SSL 证书（提供则启用 wss，不提供则用 ws —— 适合通过 nginx / ngrok 反代 SSL 的场景）
const SSL_CERT_PATH = process.env.SSL_CERT_PATH ?? ''
const SSL_KEY_PATH = process.env.SSL_KEY_PATH ?? ''
// 健康检查路径
const HEALTH_PATH = process.env.HEALTH_PATH ?? '/health'
// 房间空闲自动关闭时间（毫秒，0 表示不自动关闭）
const ROOM_IDLE_TIMEOUT = Number.parseInt(process.env.ROOM_IDLE_TIMEOUT ?? '0', 10)

const messageSync = 0
const messageAwareness = 1
const messageQueryAwareness = 3

// ---- 心跳配置 ----
// 单协作者场景下，若仅依赖 awareness（每 15s 一次），网络抖动容易导致
// y-websocket 客户端 30s 无消息判定为断线。服务器主动发送 queryAwareness
// 作为应用层心跳，既刷新客户端的 wsLastMessageReceived，又触发其回复
// awareness 状态，形成双向保活。
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '10000', 10)
// 客户端 45 秒内未发任何消息则视为死连接，主动关闭以触发客户端重连
const CLIENT_DEAD_TIMEOUT_MS = Number.parseInt(process.env.CLIENT_DEAD_TIMEOUT_MS ?? '45000', 10)

/**
 * @typedef {import('ws').WebSocket & { clientIds: Set<number>; userId?: string; username?: string; role?: string; lastMessageAt: number }} RoomClient
 */

/**
 * @typedef {{
 *   name: string
 *   doc: Y.Doc
 *   awareness: awarenessProtocol.Awareness
 *   clients: Set<RoomClient>
 *   closed: boolean
 *   idleTimer?: NodeJS.Timeout
 * }} RoomState
 */

/** @type {Map<string, RoomState>} */
const rooms = new Map()

const startTime = Date.now()

const toUint8Array = (data) => {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return new Uint8Array(data)
}

const broadcast = (room, payload, exclude = null) => {
  room.clients.forEach((client) => {
    if (client === exclude || client.readyState !== WebSocket.OPEN) return
    client.send(payload)
  })
}

const encodeMessage = (messageType, writePayload) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageType)
  writePayload(encoder)
  return encoding.toUint8Array(encoder)
}

const closeRoom = (room) => {
  if (room.closed) return
  room.closed = true
  if (room.idleTimer) clearTimeout(room.idleTimer)
  rooms.delete(room.name)
  room.awareness.destroy()
  room.doc.destroy()
}

const scheduleIdleClose = (room) => {
  if (ROOM_IDLE_TIMEOUT <= 0) return
  if (room.idleTimer) clearTimeout(room.idleTimer)
  room.idleTimer = setTimeout(() => {
    if (room.clients.size === 0) {
      console.log(`[y-websocket] room "${room.name}" idle timeout, closing`)
      closeRoom(room)
    }
  }, ROOM_IDLE_TIMEOUT)
}

const getRoom = (roomName) => {
  const existing = rooms.get(roomName)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)

  const room = {
    name: roomName,
    doc,
    awareness,
    clients: new Set(),
    closed: false,
  }

  doc.on('update', (update, origin) => {
    const payload = encodeMessage(messageSync, (encoder) => {
      syncProtocol.writeUpdate(encoder, update)
    })
    broadcast(room, payload, origin)
  })

  rooms.set(roomName, room)
  return room
}

// ---- 票据验证 ----
const verifyTicket = async (ticket, roomId) => {
  try {
    const params = new URLSearchParams({ ticket, roomId })
    const response = await fetch(
      `${COLLAB_BACKEND_URL}/internal/collab/ticket/verify?${params.toString()}`,
      { method: 'POST' },
    )
    if (!response.ok) {
      console.error(`[y-websocket] ticket verify HTTP ${response.status}`)
      return { valid: false }
    }
    const result = await response.json()
    if (result.code === 200 && result.data?.valid === true) {
      return {
        valid: true,
        userId: result.data.userId,
        username: result.data.username,
        role: result.data.role,
        permission: result.data.permission,
      }
    }
    return { valid: false }
  } catch (err) {
    console.error('[y-websocket] ticket verify request failed:', err?.message ?? err)
    return { valid: false }
  }
}

const readAwarenessClients = (update) => {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  /** @type {Array<{ clientId: number; state: unknown }>} */
  const entries = []

  for (let index = 0; index < count; index += 1) {
    const clientId = decoding.readVarUint(decoder)
    decoding.readVarUint(decoder)
    entries.push({
      clientId,
      state: JSON.parse(decoding.readVarString(decoder)),
    })
  }

  return entries
}

const sendCurrentAwareness = (room, client) => {
  const clients = Array.from(room.awareness.getStates().keys())
  const payload = encodeMessage(messageAwareness, (encoder) => {
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, clients),
    )
  })
  client.send(payload)
}

const sendSyncStep1 = (room, client) => {
  const payload = encodeMessage(messageSync, (encoder) => {
    syncProtocol.writeSyncStep1(encoder, room.doc)
  })
  client.send(payload)
}

// 主动发送 sync step2（携带完整 doc 状态）。
// ticket 验证是异步的，客户端在 WS open 时发送的 sync step1 可能在服务器注册
// message 监听器之前到达并丢失。若只发 sync step1，客户端永远收不到 step2，
// synced 永远为 false，导致连接超时。补发 step2 确保客户端能完成同步。
const sendSyncStep2 = (room, client) => {
  const payload = encodeMessage(messageSync, (encoder) => {
    syncProtocol.writeSyncStep2(encoder, room.doc)
  })
  client.send(payload)
}

const cleanupClient = (room, client) => {
  room.clients.delete(client)

  if (client.clientIds.size > 0) {
    const removedClients = Array.from(client.clientIds)
    client.clientIds.clear()
    awarenessProtocol.removeAwarenessStates(room.awareness, removedClients, client)

    const payload = encodeMessage(messageAwareness, (encoder) => {
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, removedClients),
      )
    })
    broadcast(room, payload, client)
  }

  // 同步在线人数到后端（best-effort，失败不阻塞）
  syncPeerCountToBackend(room.name, room.clients.size)

  if (room.clients.size === 0) {
    scheduleIdleClose(room)
  }
}

// ---- 同步在线人数到后端 service-collab ----
const syncPeerCountToBackend = async (roomId, onlineCount) => {
  try {
    await fetch(`${COLLAB_BACKEND_URL}/internal/collab/room/${encodeURIComponent(roomId)}/peers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onlineCount }),
    })
  } catch (err) {
    console.warn(`[y-websocket] sync peers to backend failed:`, err?.message ?? err)
  }
}

// ---- HTTP 端点：健康检查 + 房间在线人数查询 ----
const handleHealthCheck = (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`)

  // CORS 预检请求处理
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return true
  }

  // 统一添加 CORS 响应头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
  }

  // 健康检查
  if (url.pathname === HEALTH_PATH || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        rooms: rooms.size,
        totalClients: Array.from(rooms.values()).reduce((sum, r) => sum + r.clients.size, 0),
        timestamp: new Date().toISOString(),
      }),
    )
    return true
  }

  // 查询指定房间的实时在线人数
  const peersMatch = url.pathname.match(/^\/room\/([^/]+)\/peers$/)
  if (peersMatch) {
    const roomId = decodeURIComponent(peersMatch[1])
    const room = rooms.get(roomId)
    const onlineCount = room ? room.clients.size : 0
    const onlineUsers = room
      ? Array.from(room.clients)
          .filter((c) => c.userId)
          .map((c) => ({ userId: c.userId, username: c.username, role: c.role }))
      : []
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
    res.end(JSON.stringify({ roomId, onlineCount, onlineUsers }))
    return true
  }

  // 批量查询多个房间的实时在线人数
  if (url.pathname === '/rooms/peers' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        const { roomIds } = JSON.parse(body)
        const result = {}
        for (const roomId of roomIds) {
          const room = rooms.get(roomId)
          result[roomId] = room ? room.clients.size : 0
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify(result))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'invalid body' }))
      }
    })
    return true
  }

  // Force-disconnect a removed member. The backend calls this after deleting
  // the membership row; the WebSocket service is the only process that owns
  // the live socket and must close it explicitly.
  const kickMatch = url.pathname.match(/^\/room\/([^/]+)\/kick\/(.+)$/)
  if (kickMatch && req.method === 'POST') {
    const roomId = decodeURIComponent(kickMatch[1])
    const userId = decodeURIComponent(kickMatch[2])
    const room = rooms.get(roomId)
    let kicked = 0
    if (room) {
      for (const client of Array.from(room.clients)) {
        if (client.userId !== userId) continue
        try {
          client.close(4010, 'kicked')
        } catch {
          // The close event still performs cleanup if the socket is closing.
        }
        kicked++
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
    res.end(JSON.stringify({ roomId, userId, kicked }))
    return true
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders })
  res.end(JSON.stringify({ error: 'not found' }))
  return false
}

// ---- 创建服务器 ----
let httpServer = null
const useTls = Boolean(SSL_CERT_PATH && SSL_KEY_PATH)

if (useTls) {
  httpServer = https.createServer({
    cert: fs.readFileSync(SSL_CERT_PATH),
    key: fs.readFileSync(SSL_KEY_PATH),
  })
} else {
  httpServer = http.createServer()
}

// HTTP 请求处理（健康检查）
httpServer.on('request', handleHealthCheck)

const wsServer = new WebSocketServer({ server: httpServer })

wsServer.on('connection', async (socket, request) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`)
  const roomName = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'default-room'
  const ticket = url.searchParams.get('ticket')

  // ---- 票据验证（生产环境强制） ----
  if (!ticket) {
    console.warn(`[y-websocket] rejected: missing ticket for room "${roomName}"`)
    socket.close(4001, 'missing ticket')
    return
  }
  const result = await verifyTicket(ticket, roomName)
  if (!result.valid) {
    console.warn(`[y-websocket] rejected: invalid ticket for room "${roomName}"`)
    socket.close(4003, 'invalid ticket')
    return
  }

  /** @type {RoomClient} */
  const client = Object.assign(socket, {
    clientIds: new Set(),
    userId: result.userId,
    username: result.username,
    role: result.role,
    lastMessageAt: Date.now(),
  })
  const room = getRoom(roomName)
  // 取消空闲关闭定时器（有新成员加入）
  if (room.idleTimer) {
    clearTimeout(room.idleTimer)
    room.idleTimer = undefined
  }
  room.clients.add(client)

  // 同步在线人数到后端
  syncPeerCountToBackend(roomName, room.clients.size)

  console.log(
    `[y-websocket] user="${result.username}" (${result.userId}) joined room="${roomName}" role=${result.role} (${room.clients.size} online)`,
  )
  sendSyncStep1(room, client)
  sendSyncStep2(room, client)
  sendCurrentAwareness(room, client)

  client.on('message', (data) => {
    client.lastMessageAt = Date.now()
    const payload = toUint8Array(data)
    const decoder = decoding.createDecoder(payload)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case messageSync: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, client)

        const reply = encoding.toUint8Array(encoder)
        if (reply.byteLength > 1) {
          client.send(reply)
        }
        break
      }
      case messageAwareness: {
        const update = decoding.readVarUint8Array(decoder)
        const entries = readAwarenessClients(update)

        entries.forEach(({ clientId, state }) => {
          if (state === null) client.clientIds.delete(clientId)
          else client.clientIds.add(clientId)
        })

        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client)

        const awarenessPayload = encodeMessage(messageAwareness, (encoder) => {
          encoding.writeVarUint8Array(encoder, update)
        })
        broadcast(room, awarenessPayload, client)
        break
      }
      case messageQueryAwareness:
        sendCurrentAwareness(room, client)
        break
      default:
        console.warn(`[y-websocket] unsupported message type ${messageType} in room "${roomName}"`)
    }
  })

  client.on('close', () => {
    cleanupClient(room, client)
    console.log(
      `[y-websocket] user="${client.username}" left room="${roomName}" (${room.clients.size} online)`,
    )
  })

  client.on('error', (error) => {
    console.error(`[y-websocket] socket error in room "${roomName}"`, error)
  })
})

// ---- 应用层心跳：防止单协作者场景掉线 ----
// 每 HEARTBEAT_INTERVAL_MS 向所有房间的所有客户端发送 queryAwareness 消息，
// 刷新客户端 wsLastMessageReceived 时间戳；同时清理 CLIENT_DEAD_TIMEOUT_MS
// 内无任何消息的死连接。
setInterval(() => {
  const now = Date.now()
  rooms.forEach((room) => {
    if (room.closed || room.clients.size === 0) return
    const deadClients = []
    room.clients.forEach((client) => {
      if (now - client.lastMessageAt > CLIENT_DEAD_TIMEOUT_MS) {
        deadClients.push(client)
        return
      }
      if (client.readyState !== WebSocket.OPEN) return
      // 发送 queryAwareness 作为心跳：客户端收到任何消息都会刷新
      // wsLastMessageReceived，从而避免 30s 无消息断线
      const payload = encodeMessage(messageQueryAwareness, () => {})
      try {
        client.send(payload)
      } catch {
        // 发送失败（如 socket 正在关闭）忽略，下一轮心跳会清理
      }
    })
    // 清理死连接
    deadClients.forEach((client) => {
      try {
        client.close(4008, 'dead connection')
      } catch {
        // ignore
      }
    })
  })
}, HEARTBEAT_INTERVAL_MS)

httpServer.listen(port, host, () => {
  const protocol = useTls ? 'wss' : 'ws'
  console.log(`[y-websocket] production server listening on ${protocol}://${host}:${port}`)
  console.log(`[y-websocket] backend: ${COLLAB_BACKEND_URL}`)
  console.log(`[y-websocket] tls: ${useTls ? 'enabled' : 'disabled (use reverse proxy for wss)'}`)
  console.log(`[y-websocket] health check: ${protocol}://${host}:${port}${HEALTH_PATH}`)
  if (ROOM_IDLE_TIMEOUT > 0) {
    console.log(`[y-websocket] room idle timeout: ${ROOM_IDLE_TIMEOUT}ms`)
  }
})

const shutdown = () => {
  console.log('[y-websocket] shutting down...')
  wsServer.clients.forEach((client) => {
    client.close(1001, 'server shutting down')
  })
  httpServer.close(() => {
    rooms.forEach((room) => {
      closeRoom(room)
    })
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
