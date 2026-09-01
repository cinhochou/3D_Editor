/**
 * 响应式数据合并工具：用于局部动态刷新，避免全量替换导致的页面闪烁/重置。
 *
 * 核心原则：只更新真正变化的字段，保持未变化项的对象引用稳定。
 * Vue 的响应式系统基于引用对比，引用不变就不会触发重渲染，从而实现"有新才更" */

/** 将对象按字符串键索引的内部辅助类型 */
type Indexed = Record<string, unknown>

/**
 * 浅对比两个对象的顶层字段是否全部相同。
 */
export const shallowEqual = <T extends object>(a: T, b: T): boolean => {
  if (a === b) return true
  const ia = a as Indexed
  const ib = b as Indexed
  const keysA = Object.keys(ia)
  const keysB = Object.keys(ib)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (ia[key] !== ib[key]) return false
  }
  return true
}

/**
 * 用新数据 patch 旧对象：仅覆盖值不同的字段。
 * 若所有字段都未变化，返回原对象引用（保持引用稳定，Vue 不触发重渲染）。
 */
export const patchObject = <T extends object>(prev: T, next: T): T => {
  if (prev === next) return prev
  const ip = prev as Indexed
  const in_ = next as Indexed
  let changed = false
  const result: Indexed = { ...ip }
  for (const key of Object.keys(in_)) {
    if (ip[key] !== in_[key]) {
      result[key] = in_[key]
      changed = true
    }
  }
  return changed ? (result as T) : prev
}

/**
 * 按 id 合并数组，实现局部动态刷新：
 * - 保留旧项引用（未变化的）→ Vue 跳过该项重渲染
 * - 更新已变化的字段（patchObject）
 * - 追加新增项，移除已删除项
 * - 顺序跟随 next
 *
 * 若完全无变化（相同 id、相同顺序、相同内容），返回 prev 原引用 → 不触发任何更新。
 */
export const mergeArrayById = <T extends object>(
  prev: T[],
  next: T[],
  idKey: keyof T = 'id' as keyof T,
  equals: (a: T, b: T) => boolean = shallowEqual,
): T[] => {
  if (prev.length === 0) return next
  if (next.length === 0) return next

  const prevMap = new Map<unknown, T>()
  for (const item of prev) prevMap.set((item as Indexed)[idKey as string], item)

  const result: T[] = []
  let contentChanged = false

  for (const nextItem of next) {
    const id = (nextItem as Indexed)[idKey as string]
    const prevItem = prevMap.get(id)
    if (prevItem) {
      if (equals(prevItem, nextItem)) {
        // 无变化：保留旧引用，Vue 据此跳过该项重渲染
        result.push(prevItem)
      } else {
        result.push(patchObject(prevItem, nextItem))
        contentChanged = true
      }
    } else {
      result.push(nextItem)
      contentChanged = true
    }
  }

  // 长度不同说明有删除项
  if (prev.length !== next.length) {
    return result
  }

  // 内容有变化 → 返回新数组
  if (contentChanged) {
    return result
  }

  // 内容无变化，检查顺序是否变化
  for (let i = 0; i < prev.length; i++) {
    if ((prev[i] as Indexed)[idKey as string] !== (result[i] as Indexed)[idKey as string]) {
      return result
    }
  }

  // 完全无变化：返回原引用，不触发任何响应式更新
  return prev
}
