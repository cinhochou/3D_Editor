<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/store/authStore'

const authStore = useAuthStore()
const route = useRoute()
const isInitializing = ref(true)

// 全局 toast：非编辑器页面（房间列表/项目列表/回收站等）没有自己的 toast UI，
// 这里统一消费 window 'toast' 事件，避免提示被静默吞掉。
// 编辑器页（EditorView）有自己的监听和渲染，跳过以免重复显示。
const pageToastMsg = ref('')
const pageToastVisible = ref(false)
let pageToastTimer: number | null = null

const handlePageToast = (e: Event) => {
  if (route.name === 'editor') return
  const detail = (e as CustomEvent).detail
  const msg = typeof detail === 'string' ? detail : detail?.msg
  if (typeof msg !== 'string' || !msg) return
  pageToastMsg.value = msg
  pageToastVisible.value = true
  if (pageToastTimer) clearTimeout(pageToastTimer)
  pageToastTimer = window.setTimeout(() => {
    pageToastVisible.value = false
  }, 1500)
}

onMounted(async () => {
  window.addEventListener('toast', handlePageToast as EventListener)
  try {
    await authStore.initialize()
  } finally {
    isInitializing.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('toast', handlePageToast as EventListener)
  if (pageToastTimer) clearTimeout(pageToastTimer)
})
</script>

<template>
  <div v-if="isInitializing" class="loading-container">
    <div class="loading-spinner"></div>
    <div class="loading-text">加载中...</div>
  </div>
  <router-view v-else />

  <Transition name="page-toast-fade">
    <div v-if="pageToastVisible" class="page-toast-container">
      <div class="page-toast-content">
        {{ pageToastMsg }}
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #111;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(67, 242, 96, 0.25);
  border-top-color: #43f260;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  margin-top: 16px;
  color: #888;
  font-size: 14px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* 与编辑器全局 toast 视觉一致 */
.page-toast-container {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 9999;
  pointer-events: none;
}

.page-toast-content {
  background: rgba(30, 30, 30, 0.9);
  color: #43f260;
  padding: 16px 32px;
  border-radius: 4px;
  border: 1px solid #ffffff;
  font-size: 16px;
  font-weight: bold;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.page-toast-fade-enter-active,
.page-toast-fade-leave-active {
  transition: all 0.2s ease;
}

.page-toast-fade-enter-from,
.page-toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -60%);
}
</style>
