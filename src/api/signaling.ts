// src/api/signaling.ts
// 信令服务器 HTTP API 客户端：
// 用于查询房间的实时在线人数（直接从 y-websocket-server 获取，而非后端数据库）

/**
 * 从 localStorage 的 collab:join:* 记录中读取实际连接用的 wsUrl
 * （加入房间时由后端返回并写入，是 WebSocket 真正连上的信令实例地址）。
 * 在线人数查询必须与 WebSocket 连接指向同一个实例，否则 localhost 客户端
 * 会查到本机空实例而显示 0。
 */
const readJoinedWsUrl = (): string | null => {
  try {
    const PREFIX = 'collab:join:'
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(PREFIX)) {
        const raw = localStorage.getItem(key)
        if (raw) {
          const parsed = JSON.parse(raw) as { wsUrl?: string }
          if (parsed.wsUrl) return parsed.wsUrl
        }
      }
    }
  } catch {
    // 忽略读取异常，回退到默认地址
  }
  return null
}

/**
 * 获取信令服务器的 HTTP 基础地址
 * 优先使用实际加入房间时后端返回的 wsUrl（与 WebSocket 连接一致）；
 * 其次从 VITE_COLLAB_WS_URL 环境变量推导（ws→http, wss→https）；
 * 否则统一使用共享的公网信令实例。
 *
 * 注意：在线人数查询必须命中「所有真实用户都连接的那个实例」。
 * 本地开发时的 localhost:1234 是独立空实例，本机用户查它永远是 0，
 * 因此不能作为回退地址，统一回退到公网实例。
 */
// 共享信令服务的固定公网地址（ngrok 固定域名，对外为 https/wss）
//const PROD_SIGNALING_HTTP_URL = 'https://kraig-scarabaeiform-zealously.ngrok-free.dev'
const PROD_SIGNALING_HTTP_URL = 'https://47.239.188.55/signal'

const getSignalingHttpBaseUrl = (): string => {
  // 1. 实际连接使用的 wsUrl（来自后端 join 返回，最可靠）
  const joinedWsUrl = readJoinedWsUrl()
  if (joinedWsUrl) {
    return joinedWsUrl
      .replace(/^wss:\/\//i, 'https://')
      .replace(/^ws:\/\//i, 'http://')
      .replace(/\/+$/, '')
  }
  // 2. 环境变量显式配置
  const configuredWsUrl = import.meta.env.VITE_COLLAB_WS_URL?.trim()
  if (configuredWsUrl) {
    return configuredWsUrl
      .replace(/^wss:\/\//i, 'https://')
      .replace(/^ws:\/\//i, 'http://')
      .replace(/\/+$/, '')
  }
  // 3. 统一回退到共享公网实例（所有真实用户都连接这里）
  return PROD_SIGNALING_HTTP_URL
}

export interface RoomPeerInfo {
  roomId: string
  onlineCount: number
  onlineUsers: Array<{ userId: string; username: string; role: string }>
}

export const signalingApi = {
  /**
   * 查询指定房间的实时在线人数
   */
  async getRoomPeers(roomId: string): Promise<RoomPeerInfo> {
    const url = `${getSignalingHttpBaseUrl()}/room/${encodeURIComponent(roomId)}/peers`
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`signaling API error: ${response.status}`)
    }
    return response.json()
  },

  /**
   * 批量查询多个房间的实时在线人数
   * 返回 { [roomId]: onlineCount } 映射
   */
  async batchGetRoomPeers(roomIds: string[]): Promise<Record<string, number>> {
    if (roomIds.length === 0) return {}
    const url = `${getSignalingHttpBaseUrl()}/rooms/peers`
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomIds }),
      })
      if (!response.ok) {
        throw new Error(`signaling API error: ${response.status}`)
      }
      return response.json()
    } catch {
      // 信令服务器不可用时返回空映射，调用方使用后端的 memberCount 兜底
      return {}
    }
  },
}
