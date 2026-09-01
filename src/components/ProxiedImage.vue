<script setup lang="ts">
import { apiClient } from '@/api/client'
import { getApiConfig } from '@/config/api'
import { loadImageBlob } from '@/utils/imageCache'
import { ref, watch } from 'vue'

const props = defineProps<{
  src: string
  alt?: string
}>()

const isNgrokUrl = (url: string): boolean => /\.ngrok(?:-free)?\.[^/]+/i.test(url)

// 会话级 blob URL 缓存：组件卸载（如协作面板 v-if 关闭）不回收，
// 重新挂载时在 setup 阶段同步命中，渲染零延迟、零请求，彻底消除"空白→刷新"闪烁。
// LRU 策略：命中即移到末尾，容量满时淘汰最久未使用的条目。
const BLOB_URL_CACHE_MAX = 300
const blobUrlCache = new Map<string, string>()

const getCachedBlobUrl = (key: string): string | undefined => {
  const url = blobUrlCache.get(key)
  if (url) {
    // LRU touch：删除后重新插入，刷新使用顺序
    blobUrlCache.delete(key)
    blobUrlCache.set(key, url)
  }
  return url
}

const setCachedBlobUrl = (key: string, url: string): void => {
  while (blobUrlCache.size >= BLOB_URL_CACHE_MAX) {
    const oldestKey = blobUrlCache.keys().next().value
    if (oldestKey === undefined) break
    const oldestUrl = blobUrlCache.get(oldestKey)
    blobUrlCache.delete(oldestKey)
    // 正在显示中的图片会被 LRU touch 保持新鲜，被淘汰的基本是已不在页面的
    if (oldestUrl) URL.revokeObjectURL(oldestUrl)
  }
  blobUrlCache.set(key, url)
}

const resolvedSrc = ref('')

const resolveSrc = async () => {
  if (!props.src) {
    resolvedSrc.value = ''
    return
  }
  if (props.src.startsWith('http') || props.src.startsWith('data:')) {
    resolvedSrc.value = props.src
    return
  }

  const baseUrl = getApiConfig().baseUrl
  const fullUrl = baseUrl + props.src

  // 外部绝对地址（非本站 baseUrl）直接透传，不缓存
  if (props.src.startsWith('//')) {
    resolvedSrc.value = fullUrl
    return
  }

  const cached = getCachedBlobUrl(fullUrl)
  if (cached) {
    // 命中会话级缓存：resolveSrc 的同步段直接返回，首次渲染即有图
    resolvedSrc.value = cached
    return
  }

  // 统一通过 fetch 获取并缓存为 blob URL，避免 ngrok 警告页拦截，
  // 同时避免同一图片在 v-if 切换时重复发起 HTTP 请求。
  // loadImageBlob 内置 Cache Storage 持久化缓存：页面刷新后命中缓存即零网络请求。
  try {
    const accessToken = apiClient.getAccessToken()
    const isNgrok = isNgrokUrl(baseUrl)
    const blob = await loadImageBlob(fullUrl, {
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(isNgrok ? { 'ngrok-skip-browser-warning': 'true' } : {}),
      },
    })
    const blobUrl = URL.createObjectURL(blob)
    setCachedBlobUrl(fullUrl, blobUrl)
    resolvedSrc.value = blobUrl
  } catch {
    resolvedSrc.value = fullUrl
  }
}

watch(() => props.src, resolveSrc, { immediate: true })
</script>

<template>
  <img :src="resolvedSrc" :alt="alt || ''" />
</template>
