import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import { checkOtaBatch, upgradeOtaBatch } from '../api/endpoints'
import { useDevicesStore, useDialogStore } from '../stores'
import { useLoading } from './useLoading'
import { useNotice } from './useNotice'

// Batch OTA workflow. Singleton state shared by the toolbar button and OtaModal.
const showOtaModal = ref(false)
const otaResults = ref([])
const otaUpgrading = ref(false)

export function useOta() {
  const loading = useLoading()
  const { setNotice, errText } = useNotice()
  const devicesStore = useDevicesStore()
  const dialogStore = useDialogStore()
  const { selectedIds, selectedCount } = storeToRefs(devicesStore)

  function openOtaModal() {
    if (!selectedCount.value) {
      setNotice('请先勾选设备', 'err')
      return
    }
    otaResults.value = []
    otaUpgrading.value = false
    showOtaModal.value = true
  }

  function closeOtaModal() {
    showOtaModal.value = false
    otaResults.value = []
  }

  async function checkOta() {
    loading.value = true
    try {
      const response = await checkOtaBatch(selectedIds.value)
      otaResults.value = response.data && response.data.results ? response.data.results : []
    } catch (e) {
      setNotice(errText(e, '检查失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  async function upgradeOta() {
    const hasUpdateDevices = otaResults.value.filter(r => r.ok && r.hasUpdate)
    if (hasUpdateDevices.length === 0) {
      setNotice('没有可升级的设备', 'warn')
      return
    }
    const ok = await dialogStore.confirm({
      title: '确认 OTA 升级',
      message: `确定要升级 ${hasUpdateDevices.length} 台设备吗？设备会重启。`,
      confirmText: '升级',
      danger: true
    })
    if (!ok) return
    otaUpgrading.value = true
    loading.value = true
    try {
      const response = await upgradeOtaBatch(selectedIds.value)
      const results = response.data && response.data.results ? response.data.results : []
      const okCount = results.filter(r => r.ok).length
      setNotice('OTA升级完成：' + okCount + '/' + results.length, okCount ? 'ok' : 'err')
      closeOtaModal()
      await devicesStore.refresh()
    } catch (e) {
      setNotice(errText(e, '升级失败'), 'err')
    } finally {
      otaUpgrading.value = false
      loading.value = false
    }
  }

  return {
    showOtaModal,
    otaResults,
    otaUpgrading,
    openOtaModal,
    closeOtaModal,
    checkOta,
    upgradeOta
  }
}
