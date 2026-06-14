import { ref } from 'vue'

import { fetchDeviceDetail, saveDeviceSim } from '../api/endpoints'
import { useDevicesStore } from '../stores'
import { useLoading } from './useLoading'
import { useNotice } from './useNotice'

// Device detail modal + inline SIM number edit/save. Singleton state shared by
// the device table row action and DetailModal.
const showDetailModal = ref(false)
const deviceDetail = ref(null)

export function useDetail() {
  const loading = useLoading()
  const { setNotice, errText } = useNotice()
  const devicesStore = useDevicesStore()

  async function showDetail(device) {
    loading.value = true
    try {
      const response = await fetchDeviceDetail(device.id)
      deviceDetail.value = response.data
      showDetailModal.value = true
    } catch (e) {
      setNotice(errText(e, '获取详情失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  function closeDetailModal() {
    showDetailModal.value = false
    deviceDetail.value = null
  }

  async function saveSimSingle() {
    const id = deviceDetail.value && deviceDetail.value.device && deviceDetail.value.device.id
    if (!id) return
    loading.value = true
    try {
      await saveDeviceSim(id, {
        sim1: deviceDetail.value.device.sim1number || '',
        sim2: deviceDetail.value.device.sim2number || ''
      })
      setNotice('已保存卡号', 'ok')
      await devicesStore.refresh()
    } catch (e) {
      setNotice(errText(e, '保存失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  function updateDetailSim(field, value) {
    if (deviceDetail.value && deviceDetail.value.device) {
      deviceDetail.value.device[field] = value
    }
  }

  return {
    showDetailModal,
    deviceDetail,
    showDetail,
    closeDetailModal,
    saveSimSingle,
    updateDetailSim
  }
}
