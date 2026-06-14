import { storeToRefs } from 'pinia'

import { useDevicesStore, useScanStore, useDialogStore } from '../stores'
import { displayName } from '../utils/format'
import { useLoading } from './useLoading'
import { useNotice } from './useNotice'

// Device list actions: refresh / scan / selection / rename / regroup / delete /
// batch delete. These are thin adapters bridging template events to the
// devices / scan / dialog Pinia stores while mirroring the global loading ref.
export function useDeviceActions() {
  const loading = useLoading()
  const { setNotice } = useNotice()
  const devicesStore = useDevicesStore()
  const scanStore = useScanStore()
  const dialogStore = useDialogStore()
  const { selectedCount } = storeToRefs(devicesStore)

  async function refresh() {
    loading.value = true
    try {
      await devicesStore.refresh()
    } finally {
      loading.value = false
    }
  }

  async function startScanAdd() {
    await scanStore.start()
  }

  function toggleSelectAll() {
    devicesStore.toggleSelectAll()
  }

  function toggleSelect(id) {
    devicesStore.toggleSelect(id)
  }

  function isSelected(id) {
    return devicesStore.isSelected(id)
  }

  async function renameDevice(device) {
    const name = await dialogStore.prompt({
      title: '修改设备别名',
      label: '请输入设备别名：',
      defaultValue: device.alias || '',
      placeholder: '别名'
    })
    if (name === null) return
    await devicesStore.rename(device, name)
  }

  async function setGroup(device) {
    const group = await dialogStore.prompt({
      title: '修改设备分组',
      label: '请输入分组名称：',
      defaultValue: device.grp || 'auto',
      placeholder: '分组'
    })
    if (group === null) return
    await devicesStore.regroup(device, group)
  }

  async function deleteDevice(device) {
    const ok = await dialogStore.confirm({
      title: '删除设备',
      message: `确认删除设备 ${displayName(device)}？`,
      confirmText: '删除',
      danger: true
    })
    if (!ok) return
    loading.value = true
    try {
      await devicesStore.deleteOne(device)
    } finally {
      loading.value = false
    }
  }

  async function batchDeleteSelected() {
    if (!selectedCount.value) {
      setNotice('请先勾选设备', 'err')
      return
    }
    const ok = await dialogStore.confirm({
      title: '批量删除',
      message: `确认删除所选 ${selectedCount.value} 台设备？`,
      confirmText: '删除',
      danger: true
    })
    if (!ok) return
    loading.value = true
    try {
      await devicesStore.batchDeleteSelected()
    } finally {
      loading.value = false
    }
  }

  return {
    refresh,
    startScanAdd,
    toggleSelectAll,
    toggleSelect,
    isSelected,
    renameDevice,
    setGroup,
    deleteDevice,
    batchDeleteSelected
  }
}
