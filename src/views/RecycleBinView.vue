<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { roomApi } from '@/api/room'
import { projectApi } from '@/api/project'
import { useSessionGuard } from '@/composables/useSessionGuard'
import { ApiError } from '@/api/client'
import type { Room } from '@/types/room'
import type { Project } from '@/types/project'
import ProxiedImage from '@/components/ProxiedImage.vue'

const router = useRouter()
const route = useRoute()

useSessionGuard({
  onInvalidated: () => {
    router.replace({ path: '/login', query: { reason: 'expired', redirect: '/recycle-bin' } })
  },
})

const trashedRooms = ref<Room[]>([])
const trashedProjects = ref<Project[]>([])
const isLoadingRooms = ref(false)
const isLoadingProjects = ref(false)
const restoringId = ref<string | null>(null)
const purgingId = ref<string | null>(null)

// 左侧分类：'rooms' = 我的协作，'projects' = 我的项目
// 从房间列表进入 → section=rooms（我的协作）；从项目列表进入 → section=projects（我的项目）
const activeSection = ref<'rooms' | 'projects'>(
  route.query.section === 'projects' ? 'projects' : 'rooms',
)

const categoryTabs = [
  { value: 'rooms' as const, label: '我的协作' },
  { value: 'projects' as const, label: '我的项目' },
]

const RETENTION_DAYS = 30

const getDaysRemaining = (deletedAt: string | null): number => {
  if (!deletedAt) return 0
  const deleted = new Date(deletedAt)
  const expire = new Date(deleted.getTime() + RETENTION_DAYS * 86400000)
  const remaining = Math.ceil((expire.getTime() - Date.now()) / 86400000)
  return Math.max(0, remaining)
}

const loadTrashedRooms = async () => {
  isLoadingRooms.value = true
  try {
    trashedRooms.value = await roomApi.getTrashedRooms()
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '加载协作回收站失败'
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg, scope: 'global' } }))
  } finally {
    isLoadingRooms.value = false
  }
}

const loadTrashedProjects = async () => {
  isLoadingProjects.value = true
  try {
    trashedProjects.value = await projectApi.getTrashedProjects()
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '加载项目回收站失败'
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg, scope: 'global' } }))
  } finally {
    isLoadingProjects.value = false
  }
}

const switchSection = (section: 'rooms' | 'projects') => {
  activeSection.value = section
}

const restoreRoom = async (room: Room) => {
  if (restoringId.value || purgingId.value) return
  restoringId.value = room.id
  try {
    await roomApi.restoreRoom(room.id)
    trashedRooms.value = trashedRooms.value.filter((r) => r.id !== room.id)
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg: '协作已恢复', scope: 'global' } }))
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '恢复失败'
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg, scope: 'global' } }))
  } finally {
    restoringId.value = null
  }
}

const purgeRoom = async (room: Room) => {
  if (restoringId.value || purgingId.value) return
  if (!confirm(`确认彻底删除协作「${room.name}」？此操作不可撤销。`)) return
  purgingId.value = room.id
  try {
    await roomApi.purgeRoom(room.id)
    trashedRooms.value = trashedRooms.value.filter((r) => r.id !== room.id)
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg: '协作已彻底删除', scope: 'global' } }))
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '删除失败'
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg, scope: 'global' } }))
  } finally {
    purgingId.value = null
  }
}

const restoreProject = async (project: Project) => {
  if (restoringId.value || purgingId.value) return
  restoringId.value = project.id
  try {
    await projectApi.restoreProject(project.id)
    trashedProjects.value = trashedProjects.value.filter((p) => p.id !== project.id)
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg: '项目已恢复', scope: 'global' } }))
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '恢复失败'
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg, scope: 'global' } }))
  } finally {
    restoringId.value = null
  }
}

const purgeProject = async (project: Project) => {
  if (restoringId.value || purgingId.value) return
  if (!confirm(`确认彻底删除项目「${project.name}」？此操作不可撤销。`)) return
  purgingId.value = project.id
  try {
    await projectApi.purgeProject(project.id)
    trashedProjects.value = trashedProjects.value.filter((p) => p.id !== project.id)
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg: '项目已彻底删除', scope: 'global' } }))
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '删除失败'
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg, scope: 'global' } }))
  } finally {
    purgingId.value = null
  }
}

const goToEditor = () => router.push('/')
const goToRooms = () => router.push('/rooms')
const goToProjects = () => router.push('/projects')

onMounted(() => {
  loadTrashedRooms()
  loadTrashedProjects()
})
</script>

<template>
  <div class="rb-page">
    <div class="rb-sticky-top">
      <header class="rb-header">
        <div class="rb-header-inner">
          <img src="@/assets/GeoMesh3D_logo_white_1240x300.png" class="rb-logo" @click="goToEditor" alt="GeoMesh3D" />
          <h1 class="rb-title">回收站</h1>
          <div class="rb-header-actions">
            <div class="rb-action-wrap">
              <button class="rb-header-action-btn" @click="goToRooms" title="房间列表">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </button>
              <div class="rb-tooltip">房间列表</div>
            </div>
            <div class="rb-action-wrap">
              <button class="rb-header-action-btn" @click="goToProjects" title="项目列表">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <div class="rb-tooltip">项目列表</div>
            </div>
          </div>
        </div>
      </header>
      <div class="rb-divider"></div>
    </div>

    <div class="rb-body">
      <div class="rb-body-inner">
        <!-- 左侧分类按钮 -->
        <aside class="rb-sidebar">
          <button
            v-for="tab in categoryTabs"
            :key="tab.value"
            class="rb-category-btn"
            :class="{ active: activeSection === tab.value }"
            @click="switchSection(tab.value)"
          >
            <svg
              v-if="tab.value === 'rooms'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>{{ tab.label }}</span>
            <span class="rb-category-count">
              {{ tab.value === 'rooms' ? trashedRooms.length : trashedProjects.length }}
            </span>
          </button>
        </aside>

        <!-- 右侧回收内容 -->
        <div class="rb-content">
          <!-- 我的协作（房间） -->
          <section v-if="activeSection === 'rooms'" class="rb-section">
            <div class="rb-section-header">
              <h2 class="rb-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                我的协作
              </h2>
              <span class="rb-section-count">{{ trashedRooms.length }} 个协作</span>
            </div>
            <div v-if="isLoadingRooms" class="rb-loading">
              <div class="rb-spinner"></div>
              <span>加载中...</span>
            </div>
            <div v-else-if="trashedRooms.length === 0" class="rb-empty">
              <p>回收站为空</p>
            </div>
            <div v-else class="rb-list">
              <div v-for="room in trashedRooms" :key="room.id" class="rb-card">
                <div class="rb-card-cover">
                  <ProxiedImage
                    v-if="room.projectThumbnailUrl"
                    :src="room.projectThumbnailUrl"
                    class="rb-card-img"
                    alt=""
                  />
                  <div v-else class="rb-card-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    </svg>
                  </div>
                </div>
                <div class="rb-card-info">
                  <div class="rb-card-name" :title="room.name">{{ room.name }}</div>
                  <div class="rb-card-meta">
                    <span class="rb-card-time">删除于 {{ new Date(room.deletedAt!).toLocaleDateString('zh-CN') }}</span>
                    <span class="rb-card-remaining" :class="{ 'is-expiring': getDaysRemaining(room.deletedAt) <= 3 }">
                      剩余 {{ getDaysRemaining(room.deletedAt) }} 天
                    </span>
                  </div>
                </div>
                <div class="rb-card-actions">
                  <button
                    class="rb-btn rb-btn-restore"
                    :disabled="restoringId === room.id || purgingId === room.id"
                    @click="restoreRoom(room)"
                  >{{ restoringId === room.id ? '恢复中...' : '恢复' }}</button>
                  <button
                    class="rb-btn rb-btn-purge"
                    :disabled="restoringId === room.id || purgingId === room.id"
                    @click="purgeRoom(room)"
                  >{{ purgingId === room.id ? '删除中...' : '彻底删除' }}</button>
                </div>
              </div>
            </div>
          </section>

          <!-- 我的项目 -->
          <section v-else class="rb-section">
            <div class="rb-section-header">
              <h2 class="rb-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                我的项目
              </h2>
              <span class="rb-section-count">{{ trashedProjects.length }} 个项目</span>
            </div>
            <div v-if="isLoadingProjects" class="rb-loading">
              <div class="rb-spinner"></div>
              <span>加载中...</span>
            </div>
            <div v-else-if="trashedProjects.length === 0" class="rb-empty">
              <p>回收站为空</p>
            </div>
            <div v-else class="rb-list">
              <div v-for="project in trashedProjects" :key="project.id" class="rb-card">
                <div class="rb-card-cover">
                  <ProxiedImage
                    v-if="project.thumbnailUrl"
                    :src="project.thumbnailUrl"
                    class="rb-card-img"
                    alt=""
                  />
                  <div v-else class="rb-card-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                  </div>
                </div>
                <div class="rb-card-info">
                  <div class="rb-card-name" :title="project.name">{{ project.name }}</div>
                  <div class="rb-card-meta">
                    <span class="rb-card-time">删除于 {{ new Date(project.deletedAt!).toLocaleDateString('zh-CN') }}</span>
                    <span class="rb-card-remaining" :class="{ 'is-expiring': getDaysRemaining(project.deletedAt) <= 3 }">
                      剩余 {{ getDaysRemaining(project.deletedAt) }} 天
                    </span>
                  </div>
                </div>
                <div class="rb-card-actions">
                  <button
                    class="rb-btn rb-btn-restore"
                    :disabled="restoringId === project.id || purgingId === project.id"
                    @click="restoreProject(project)"
                  >{{ restoringId === project.id ? '恢复中...' : '恢复' }}</button>
                  <button
                    class="rb-btn rb-btn-purge"
                    :disabled="restoringId === project.id || purgingId === project.id"
                    @click="purgeProject(project)"
                  >{{ purgingId === project.id ? '删除中...' : '彻底删除' }}</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rb-page {
  position: relative;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(67, 242, 96, 0.08), transparent 22%),
    radial-gradient(circle at bottom right, rgba(255, 255, 255, 0.04), transparent 18%),
    linear-gradient(180deg, #141414 0%, #101010 100%);
  color: #ddd;
  display: flex;
  flex-direction: column;
}
.rb-sticky-top {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 10;
  background:
    radial-gradient(circle at top left, rgba(67, 242, 96, 0.08), transparent 22%),
    linear-gradient(180deg, #141414 0%, #121212 100%);
}
.rb-header { padding: 20px 28px; }
.rb-header-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
}
.rb-logo {
  height: 32px;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.15s ease;
}
.rb-logo:hover { opacity: 1; }
.rb-title {
  font-size: 22px;
  font-weight: 700;
  color: #f5f5f5;
  margin: 0;
  flex: 1;
}
.rb-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rb-action-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.rb-header-action-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid #3d3d3d;
  background: #252525;
  color: #ccc;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.rb-header-action-btn:hover {
  border-color: #43f260;
  color: #43f260;
  background: #2a2a2a;
  box-shadow: 0 0 0 2px rgba(67, 242, 96, 0.1);
}
.rb-header-action-btn svg { width: 18px; height: 18px; }
.rb-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 10px;
  border-radius: 6px;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.15s ease,
    visibility 0.15s ease;
}
.rb-tooltip::after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: #2a2a2a;
}
.rb-action-wrap:hover .rb-tooltip {
  opacity: 1;
  visibility: visible;
}

.rb-divider {
  height: 1px;
  background: #2a2a2a;
  margin: 0 28px;
}

.rb-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}
.rb-body-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  gap: 28px;
  align-items: flex-start;
}

/* 左侧分类侧栏 */
.rb-sidebar {
  position: sticky;
  top: 0;
  flex-shrink: 0;
  width: 200px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.rb-category-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid #3d3d3d;
  background: linear-gradient(180deg, #1f1f1f 0%, #181818 100%);
  color: #ccc;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}
.rb-category-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
.rb-category-btn:hover {
  border-color: #555;
  color: #f5f5f5;
  background: #2a2a2a;
}
.rb-category-btn.active {
  border-color: #43f260;
  color: #43f260;
  background: rgba(67, 242, 96, 0.08);
}
.rb-category-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: #888;
  background: #2a2a2a;
  border-radius: 10px;
  padding: 2px 8px;
}
.rb-category-btn.active .rb-category-count {
  color: #43f260;
  background: rgba(67, 242, 96, 0.15);
}

/* 右侧内容 */
.rb-content {
  flex: 1;
  min-width: 0;
}
.rb-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.rb-section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #2a2a2a;
}
.rb-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 700;
  color: #f5f5f5;
  margin: 0;
}
.rb-section-title svg { width: 20px; height: 20px; color: #43f260; }
.rb-section-count {
  font-size: 13px;
  color: #888;
}

.rb-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
  color: #888;
  justify-content: center;
}
.rb-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #3d3d3d;
  border-top-color: #43f260;
  border-radius: 50%;
  animation: rb-spin 0.8s linear infinite;
}
@keyframes rb-spin { to { transform: rotate(360deg); } }

.rb-empty {
  text-align: center;
  padding: 40px 0;
  color: #666;
}
.rb-empty p { margin: 0; font-size: 14px; }

.rb-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rb-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: linear-gradient(180deg, #1f1f1f 0%, #181818 100%);
  border: 1px solid #3d3d3d;
  border-radius: 12px;
  transition: border-color 0.15s ease;
}
.rb-card:hover { border-color: #555; }

.rb-card-cover {
  width: 64px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  background: #111;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rb-card-img { width: 100%; height: 100%; object-fit: cover; }
.rb-card-placeholder { color: #444; }
.rb-card-placeholder svg { width: 24px; height: 24px; }

.rb-card-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rb-card-name {
  font-size: 15px;
  font-weight: 600;
  color: #f5f5f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rb-card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}
.rb-card-time { color: #888; }
.rb-card-remaining { color: #aaa; }
.rb-card-remaining.is-expiring { color: #ff6b6b; }

.rb-card-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.rb-btn {
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid #3d3d3d;
  background: #252525;
  color: #ccc;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.rb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rb-btn-restore:hover:not(:disabled) {
  border-color: #43f260;
  color: #43f260;
  background: rgba(67, 242, 96, 0.08);
}
.rb-btn-purge:hover:not(:disabled) {
  border-color: #ff6b6b;
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.08);
}

@media (max-width: 768px) {
  .rb-body-inner {
    flex-direction: column;
  }
  .rb-sidebar {
    width: 100%;
    flex-direction: row;
    position: static;
  }
  .rb-category-btn {
    flex: 1;
    justify-content: center;
  }
}
</style>