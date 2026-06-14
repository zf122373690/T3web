import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import { applyWifiBatch, previewWifiBatch } from '../api/endpoints'
import { useDevicesStore } from '../stores'
import { useLoading } from './useLoading'
import { useNotice } from './useNotice'

// Batch WiFi workflow (modal open flag + preview/apply). Singleton state so the
// toolbar button and WifiModal share it.
const showWifiModal = ref(false)
const wifiSsid = ref('')
const wifiPwd = ref('')
const wifiPreviewResults = ref([])

export function useWifi() {
  const loading = useLoading()
  const { setNotice, errText } = useNotice()
  const devicesStore = useDevicesStore()
  const { selectedIds, selectedCount } = storeToRefs(devicesStore)

  function openWifiModal() {
    if (!selectedCount.value) {
      setNotice('请先勾选设备', 'err')
      return
    }
    showWifiModal.value = true
  }

  function closeWifiModal() {
    showWifiModal.value = false
    wifiSsid.value = ''
    wifiPwd.value = ''
    wifiPreviewResults.value = []
  }

  async function previewWifi() {
    if (!wifiSsid.value.trim()) {
      setNotice('请输入SSID', 'err')
      return
    }
    if (!selectedCount.value) {
      setNotice('请先勾选设备', 'err')
      return
    }
    loading.value = true
    try {
      const response = await previewWifiBatch({
        device_ids: selectedIds.value,
        ssid: wifiSsid.value.trim(),
        pwd: wifiPwd.value.trim()
      })
      wifiPreviewResults.value = response.data && response.data.results ? response.data.results : []
      setNotice(`预览完成：共 ${wifiPreviewResults.value.length} 台设备`, 'ok')
    } catch (e) {
      setNotice(errText(e, '预览失败'), 'err')
      wifiPreviewResults.value = []
    } finally {
      loading.value = false
    }
  }

  async function applyWifi() {
    if (!wifiSsid.value.trim()) {
      setNotice('请输入SSID', 'err')
      return
    }
    if (!selectedCount.value) {
      setNotice('请先勾选设备', 'err')
      return
    }
    loading.value = true
    try {
      const response = await applyWifiBatch({
        device_ids: selectedIds.value,
        ssid: wifiSsid.value.trim(),
        pwd: wifiPwd.value.trim()
      })
      const list = response.data && response.data.results ? response.data.results : []
      const okCount = list.filter(item => item.ok).length
      setNotice('WiFi 添加完成：' + okCount + '/' + list.length, okCount ? 'ok' : 'err')
      wifiPreviewResults.value = []
      closeWifiModal()
    } catch (e) {
      setNotice(errText(e, '配置失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  return {
    showWifiModal,
    wifiSsid,
    wifiPwd,
    wifiPreviewResults,
    openWifiModal,
    closeWifiModal,
    previewWifi,
    applyWifi
  }
}
