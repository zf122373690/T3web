// FIX(P2#5): scan workflow extracted into its own store. The polling
// loop, status mapping and post-scan refresh used to live as a 50-line
// async function in App.vue's <script setup>; here it can be unit tested
// (and reused) without dragging the whole component along.
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { getScanStatus, startScan } from '../api/endpoints'
import { useDevicesStore } from './devices'
import { useNoticeStore } from './notice'

const POLL_INTERVAL_MS = 2000
const POLL_MAX_TICKS = 60

export const useScanStore = defineStore('scan', () => {
  const scanning = ref(false)

  async function start() {
    if (scanning.value) return
    const notice = useNoticeStore()
    const devicesStore = useDevicesStore()
    scanning.value = true
    notice.set('正在提交扫描任务...', 'info')
    try {
      const scanResp = await startScan({})
      const scanId = scanResp.data && scanResp.data.scanId
      if (!scanId) {
        notice.set('扫描任务创建失败', 'err')
        return
      }
      notice.set('扫描进行中，请稍候...', 'info')
      let completed = false
      for (let i = 0; i < POLL_MAX_TICKS; i++) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
        try {
          const statusResp = await getScanStatus(scanId)
          const st = statusResp.data || {}
          const progress = st.progress || ''
          if (st.status === 'done') {
            completed = true
            notice.set(`扫描完成，发现 ${st.found} 台设备`, st.found ? 'ok' : 'warn')
            await devicesStore.refresh()
            break
          } else if (st.status === 'error') {
            completed = true
            notice.set(progress || '扫描出错', 'err')
            await devicesStore.refresh()
            break
          } else if (progress) {
            notice.set(`扫描中: ${progress}`, 'info')
          }
        } catch {
          // status query failure -- keep polling
        }
      }
      if (!completed) {
        notice.set('扫描超时，设备可能稍后出现，可点一次刷新确认', 'warn')
        await devicesStore.refresh()
      }
    } catch (e) {
      const detail = e && e.response && e.response.data && e.response.data.detail
      notice.set(detail || '扫描启动失败，请检查网络连接', 'err')
    } finally {
      scanning.value = false
    }
  }

  return { scanning, start }
})
