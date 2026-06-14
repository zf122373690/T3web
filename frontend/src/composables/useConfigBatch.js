import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import {
  previewConfigPreset,
  previewDeviceConfig,
  readDeviceConfigs,
  writeConfigPreset,
  writeDeviceConfig
} from '../api/endpoints'
import { useDevicesStore, useDialogStore } from '../stores'
import { useLoading } from './useLoading'
import { useNotice } from './useNotice'

// Batch config read / regex-replace / preset-clean / write workflow.
// Singleton state shared by the toolbar button and the config modal.
const showConfigModal = ref(false)
const configStep = ref('read')
const configData = ref([])
const configPattern = ref('')
const configReplacement = ref('')
const configFlags = ref('s')
const configPreviewData = ref([])
const configExpandedIds = ref([])
const configMode = ref('regex')

function diffLines(original, replaced) {
  const oLines = (original || '').split('\n')
  const rLines = (replaced || '').split('\n')
  const maxLen = Math.max(oLines.length, rLines.length)
  const lines = []
  for (let i = 0; i < maxLen; i++) {
    const o = oLines[i] !== undefined ? oLines[i] : ''
    const r = rLines[i] !== undefined ? rLines[i] : ''
    if (o === r) {
      lines.push({ type: 'same', text: o })
    } else {
      if (o) lines.push({ type: 'del', text: o })
      if (r) lines.push({ type: 'add', text: r })
    }
  }
  return lines
}

export function useConfigBatch() {
  const loading = useLoading()
  const { setNotice, errText } = useNotice()
  const devicesStore = useDevicesStore()
  const dialogStore = useDialogStore()
  const { selectedIds, selectedCount } = storeToRefs(devicesStore)

  function openConfigModal() {
    if (!selectedCount.value) {
      setNotice('请先勾选设备', 'err')
      return
    }
    configStep.value = 'read'
    configData.value = []
    configPattern.value = ''
    configReplacement.value = ''
    configFlags.value = 's'
    configPreviewData.value = []
    configExpandedIds.value = []
    configMode.value = 'regex'
    showConfigModal.value = true
  }

  function closeConfigModal() {
    showConfigModal.value = false
    configData.value = []
    configPreviewData.value = []
    configExpandedIds.value = []
  }

  async function readConfigs() {
    if (!selectedCount.value) {
      setNotice('请先勾选设备', 'err')
      return
    }
    loading.value = true
    try {
      const resp = await readDeviceConfigs(selectedIds.value)
      configData.value = resp.data && resp.data.configs ? resp.data.configs : []
      configStep.value = 'edit'
      const firstOk = configData.value.find(item => item.ok)
      configExpandedIds.value = firstOk ? [firstOk.id] : []
      setNotice(`读取完成：${configData.value.filter(item => item.ok).length}/${configData.value.length}`, 'info')
    } catch (e) {
      setNotice(errText(e, '读取配置失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  function toggleConfigExpand(id) {
    const idx = configExpandedIds.value.indexOf(id)
    if (idx > -1) {
      configExpandedIds.value.splice(idx, 1)
    } else {
      configExpandedIds.value.push(id)
    }
  }

  async function previewConfig() {
    if (!configPattern.value.trim()) {
      setNotice('请输入正则表达式', 'err')
      return
    }
    loading.value = true
    try {
      const resp = await previewDeviceConfig({
        device_ids: selectedIds.value,
        pattern: configPattern.value,
        replacement: configReplacement.value,
        flags: configFlags.value
      })
      configPreviewData.value = resp.data && resp.data.previews ? resp.data.previews : []
      configStep.value = 'preview'
      const firstChanged = configPreviewData.value.find(item => item.ok && item.changed)
      const firstResult = firstChanged || configPreviewData.value[0]
      configExpandedIds.value = firstResult ? [firstResult.id] : []
      setNotice(`预览完成：${configPreviewData.value.filter(item => item.ok && item.changed).length} 台有变更`, 'info')
    } catch (e) {
      setNotice(errText(e, '预览失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  async function previewCleanMessageTemplates() {
    loading.value = true
    try {
      const resp = await previewConfigPreset(selectedIds.value, 'clean_message_templates')
      configPreviewData.value = resp.data && resp.data.previews ? resp.data.previews : []
      configStep.value = 'preview'
      configMode.value = 'clean_message_templates'
      const firstChanged = configPreviewData.value.find(item => item.ok && item.changed)
      const firstResult = firstChanged || configPreviewData.value[0]
      configExpandedIds.value = firstResult ? [firstResult.id] : []
      setNotice(`简洁模板预览完成：${configPreviewData.value.filter(item => item.ok && item.changed).length} 台有变更`, 'info')
    } catch (e) {
      setNotice(errText(e, '预览失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  async function writeConfigs() {
    const changedCount = configPreviewData.value.filter(item => item.ok && item.changed).length
    if (!changedCount) {
      setNotice('预览没有发现可写入的变更', 'warn')
      return
    }
    const modeText = configMode.value === 'clean_message_templates' ? '应用简洁消息模板' : '按正则替换'
    const ok = await dialogStore.confirm({
      title: '确认写入配置',
      message: `确认对 ${changedCount} 台设备写入配置？\n本次操作：${modeText}。\n会先重新读取每台设备当前配置，写入后再读回校验。`,
      confirmText: '写入',
      danger: true
    })
    if (!ok) return
    loading.value = true
    try {
      const payload = { device_ids: selectedIds.value }
      const resp = configMode.value === 'clean_message_templates'
        ? await writeConfigPreset(selectedIds.value, 'clean_message_templates')
        : await writeDeviceConfig({
          ...payload,
          pattern: configPattern.value,
          replacement: configReplacement.value,
          flags: configFlags.value
        })
      const results = resp.data && resp.data.results ? resp.data.results : []
      const okCount = results.filter(item => item.ok).length
      const changed = results.filter(item => item.changed).length
      setNotice(`配置写入完成：${okCount}/${results.length} 成功，${changed} 台有变更`, okCount ? 'ok' : 'err')
      closeConfigModal()
    } catch (e) {
      setNotice(errText(e, '写入失败'), 'err')
    } finally {
      loading.value = false
    }
  }

  return {
    showConfigModal,
    configStep,
    configData,
    configPattern,
    configReplacement,
    configFlags,
    configPreviewData,
    configExpandedIds,
    configMode,
    diffLines,
    openConfigModal,
    closeConfigModal,
    readConfigs,
    toggleConfigExpand,
    previewConfig,
    previewCleanMessageTemplates,
    writeConfigs
  }
}
