// FIX(P2#5): device list state and the actions that mutate it (refresh,
// rename, regroup, delete, batch delete, select toggling) extracted out
// of App.vue. The component keeps the Vue-specific bits (search bar
// `v-model`, click handlers) but no longer owns the data plumbing.
//
// FIX(P2#7): real server-side pagination + filter. The store now owns
// `page` / `pageSize` / `total` / `pages` and sends `q` / `group` to the
// backend. The old client-side `filteredDevices` / `filteredNumbers`
// computed are gone -- the server returns exactly the page the user
// sees, so a 10k-device deployment loads ~100 rows per fetch instead of
// pulling everything into the browser.
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import {
  batchDeleteDevices,
  deleteDeviceById,
  fetchDeviceGroups,
  fetchDevicesPage,
  fetchNumbersPage,
  setDeviceAlias,
  setDeviceGroup
} from '../api/endpoints'
import { displayName } from '../utils/format'
import { useNoticeStore } from './notice'

const DEFAULT_PAGE_SIZE = 100

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref([])
  const numbers = ref([])
  // FIX(P2#7, Devin Review #8): the sender dropdown in MessagePanel
  // needs *every* SIM regardless of pagination / search filter so the
  // user can pick any card to send SMS or dial. We keep a second
  // unfiltered list, refreshed alongside the paginated number list.
  const allNumbers = ref([])
  const groups = ref([])

  const devicesTotal = ref(0)
  const numbersTotal = ref(0)
  // FIX(P2#7, Devin Review #8): online/offline computed from
  // devices.value would only reflect the current page, drifting from
  // devicesTotal once there are multiple pages. Backend now returns
  // these as global counts in the response envelope.
  const devicesOnline = ref(0)
  const devicesOffline = ref(0)
  const devicesPage = ref(1)
  const devicesPageSize = ref(DEFAULT_PAGE_SIZE)
  const devicesPages = ref(0)
  const numbersPage = ref(1)
  const numbersPageSize = ref(DEFAULT_PAGE_SIZE)
  const numbersPages = ref(0)

  const searchText = ref('')
  const groupFilter = ref('all')
  const selectedIds = ref([])
  const loading = ref(false)

  const uniqueGroups = computed(() => {
    // Server-side groups list keeps the dropdown stable across pages.
    // Always include the synthetic "all" entry.
    const seen = new Set(['all'])
    groups.value.forEach(g => { if (g) seen.add(g) })
    devices.value.forEach(d => { if (d.grp) seen.add(d.grp) })
    return Array.from(seen)
  })

  // Online / offline are global filtered counts coming from the backend
  // envelope, so the StatsGrid header satisfies online + offline = total
  // even when the visible page only shows a subset.
  const onlineCount = computed(() => devicesOnline.value)
  const offlineCount = computed(() => devicesOffline.value)
  const selectedCount = computed(() => selectedIds.value.length)
  // O(1) membership lookups for isSelected(), which the device table calls
  // once per visible row on every render. Rebuilt only when the selection
  // changes, turning the per-render cost from O(n^2) (Array.includes per
  // row) into O(n).
  const _selectedSet = computed(() => new Set(selectedIds.value))

  // FIX(P2#7): preserved as identity getters so App.vue / child components
  // keep their existing bindings. The "filtering" already happened on the
  // server.
  const filteredDevices = computed(() => devices.value)
  const filteredNumbers = computed(() => numbers.value)

  function _detail(e, fallback) {
    return (e && e.response && e.response.data && e.response.data.detail) || fallback
  }

  async function refresh() {
    const notice = useNoticeStore()
    loading.value = true
    try {
      const [devPage, numPage, groupList] = await Promise.all([
        fetchDevicesPage({
          page: devicesPage.value,
          pageSize: devicesPageSize.value,
          q: searchText.value.trim(),
          group: groupFilter.value
        }),
        fetchNumbersPage({
          page: numbersPage.value,
          pageSize: numbersPageSize.value,
          q: searchText.value.trim(),
          group: groupFilter.value
        }),
        fetchDeviceGroups()
      ])
      devices.value = devPage.items
      devicesTotal.value = devPage.total
      devicesOnline.value = devPage.onlineCount || 0
      devicesOffline.value = devPage.offlineCount || Math.max((devPage.total || 0) - (devPage.onlineCount || 0), 0)
      devicesPage.value = devPage.page
      devicesPageSize.value = devPage.pageSize
      devicesPages.value = devPage.pages

      numbers.value = numPage.items
      numbersTotal.value = numPage.total
      numbersPage.value = numPage.page
      numbersPageSize.value = numPage.pageSize
      numbersPages.value = numPage.pages

      groups.value = groupList

      // FIX(P2#7, Devin Review #8): the unfiltered SIM list for the
      // sender dropdown is fetched outside the critical Promise.all so a
      // failure (e.g. an operator setting BMDEVICESMAXPAGESIZE below the
      // page size we ask for, or a transient backend error) only loses
      // the dropdown -- it doesn't blank the whole dashboard. The page
      // size matches the backend default cap.
      try {
        const allNumPage = await fetchNumbersPage({ page: 1, pageSize: 1000 })
        allNumbers.value = allNumPage.items
      } catch {
        // Leave the previous list in place; the dropdown still works
        // with stale-but-non-empty data better than empty data.
      }
    } catch (e) {
      if (!(e && e.response && e.response.status === 401)) {
        notice.set('获取数据失败，请检查网络连接', 'err')
      }
    } finally {
      loading.value = false
    }
  }

  // FIX(P2#7): when the user types in the search box or changes the
  // group dropdown we reset to page 1 and refetch. A 250ms debounce on
  // searchText keeps us from hammering the backend on every keystroke.
  let _searchDebounce = null
  watch(searchText, () => {
    if (_searchDebounce) clearTimeout(_searchDebounce)
    _searchDebounce = setTimeout(() => {
      devicesPage.value = 1
      numbersPage.value = 1
      refresh()
    }, 250)
  })
  watch(groupFilter, () => {
    // FIX(P2#7, Devin Review #8): also reset numbersPage so a group
    // change while on numbers page >1 doesn't request an out-of-range
    // page (now that /api/numbers honours the group filter).
    devicesPage.value = 1
    numbersPage.value = 1
    refresh()
  })

  function setDevicesPage(n) {
    const target = Math.max(1, Math.min(devicesPages.value || 1, Number(n) || 1))
    if (target === devicesPage.value) return
    devicesPage.value = target
    refresh()
  }

  function setNumbersPage(n) {
    const target = Math.max(1, Math.min(numbersPages.value || 1, Number(n) || 1))
    if (target === numbersPage.value) return
    numbersPage.value = target
    refresh()
  }

  function toggleSelect(id) {
    const idx = selectedIds.value.indexOf(id)
    if (idx > -1) {
      selectedIds.value.splice(idx, 1)
    } else {
      selectedIds.value.push(id)
    }
  }

  function toggleSelectAll() {
    // FIX(P2#7): "select all" now means the current page only. With
    // server-side pagination we don't have IDs for off-page rows, and
    // even if we did, asking the user to confirm a destructive batch
    // action against thousands of unseen devices is hostile UX.
    const list = devices.value
    const allSelected = list.length > 0 && list.every(d => selectedIds.value.includes(d.id))
    if (allSelected) {
      const visible = new Set(list.map(d => d.id))
      selectedIds.value = selectedIds.value.filter(id => !visible.has(id))
    } else {
      const merged = new Set(selectedIds.value)
      list.forEach(d => merged.add(d.id))
      selectedIds.value = Array.from(merged)
    }
  }

  function isSelected(id) {
    return _selectedSet.value.has(id)
  }

  function clearSelection() {
    selectedIds.value = []
  }

  async function rename(device, alias) {
    const notice = useNoticeStore()
    try {
      await setDeviceAlias(device.id, alias)
      notice.set('已更新别名', 'ok')
      await refresh()
    } catch (e) {
      notice.set(_detail(e, '更新失败'), 'err')
    }
  }

  async function regroup(device, group) {
    const notice = useNoticeStore()
    try {
      await setDeviceGroup(device.id, group)
      notice.set('已更新分组', 'ok')
      await refresh()
    } catch (e) {
      notice.set(_detail(e, '更新失败'), 'err')
    }
  }

  async function deleteOne(device) {
    const notice = useNoticeStore()
    loading.value = true
    try {
      await deleteDeviceById(device.id)
      notice.set('已删除', 'ok')
      await refresh()
    } catch (e) {
      notice.set(_detail(e, '删除失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  async function batchDeleteSelected() {
    const notice = useNoticeStore()
    const total = selectedCount.value
    loading.value = true
    try {
      const response = await batchDeleteDevices(selectedIds.value)
      const deleted = response.data && response.data.deleted ? response.data.deleted : 0
      notice.set(`删除完成：${deleted}/${total}`, deleted ? 'ok' : 'warn')
      selectedIds.value = []
      await refresh()
    } catch (e) {
      notice.set(_detail(e, e.message || '删除失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  return {
    devices,
    numbers,
    allNumbers,
    devicesTotal,
    numbersTotal,
    devicesPage,
    devicesPageSize,
    devicesPages,
    numbersPage,
    numbersPageSize,
    numbersPages,
    searchText,
    groupFilter,
    selectedIds,
    loading,
    uniqueGroups,
    onlineCount,
    offlineCount,
    selectedCount,
    filteredDevices,
    filteredNumbers,
    refresh,
    setDevicesPage,
    setNumbersPage,
    toggleSelect,
    toggleSelectAll,
    isSelected,
    clearSelection,
    rename,
    regroup,
    deleteOne,
    batchDeleteSelected,
    displayName
  }
})
