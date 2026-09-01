// src/utils/collabRoomEvents.ts
// 跨 Tab 协作房间状态同步事件总线：
// - 基于 localStorage + storage 事件实现跨 Tab 通信
// - 用于房间列表页与编辑器页之间的协作状态同步
//   例如：在房间列表页离开房间 → 编辑器页自动退出协作

export type CollabRoomEventType =
  | 'leave'
  | 'join'
  | 'close'
  | 'reopen'
  | 'visibility_change'
  | 'role_change'
  | 'permission_change'
  | 'kick'

export interface CollabRoomEvent {
  type: CollabRoomEventType
  roomId: string
  // 触发时间戳，用于去重（同一事件可能被多次触发）
  timestamp: number
  // visibility_change：房间公开/私密状态
  isPublic?: boolean
  // role_change：被变更角色的目标用户 ID 及新角色
  targetUserId?: string
  role?: string
  permission?: string
  value?: boolean | string
}

const STORAGE_KEY = 'collab:room_event:v1'

type Listener = (event: CollabRoomEvent) => void

const listeners = new Set<Listener>()

// 监听 storage 事件（跨 Tab 触发）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return
    try {
      const event: CollabRoomEvent = JSON.parse(e.newValue)
      for (const listener of listeners) {
        try {
          listener(event)
        } catch (err) {
          console.error('[collabRoomEvents] listener threw:', err)
        }
      }
    } catch {
      // 忽略非法 JSON
    }
  })
}

export const collabRoomEvents = {
  on(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  off(listener: Listener): void {
    listeners.delete(listener)
  },

  emit(event: CollabRoomEvent): void {
    // 写入 localStorage 触发其他 Tab 的 storage 事件
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(event))
    } catch {
      // 忽略写入失败
    }
    // 同 Tab 内直接派发
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[collabRoomEvents] listener threw:', err)
      }
    }
  },
}
