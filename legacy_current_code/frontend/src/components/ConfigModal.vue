<script setup>
import { storeToRefs } from 'pinia'

import { useDevicesStore } from '../stores'
import { useLoading } from '../composables/useLoading'
import { useConfigBatch } from '../composables/useConfigBatch'

const loading = useLoading()
const { selectedCount } = storeToRefs(useDevicesStore())
const {
  configStep,
  configData,
  configPattern,
  configReplacement,
  configFlags,
  configPreviewData,
  configExpandedIds,
  configMode,
  diffLines,
  closeConfigModal,
  readConfigs,
  toggleConfigExpand,
  previewConfig,
  previewCleanMessageTemplates,
  writeConfigs
} = useConfigBatch()
</script>

<template>
  <div class="modal-overlay" @click.self="closeConfigModal">
    <div class="modal modal-xl">
      <div class="modal-header">
        <h3>批量设备配置</h3>
        <button class="modal-close" @click="closeConfigModal">×</button>
      </div>
      <div class="modal-body">
        <div v-if="configStep === 'read'" class="config-intro">
          <p class="config-info">先读取 {{ selectedCount }} 台设备当前配置，再用正则只替换匹配到的片段，避免覆盖每台设备不同的数据。</p>
          <button class="btn-confirm full-width" @click="readConfigs" :disabled="loading">
            {{ loading ? '读取中...' : '读取配置' }}
          </button>
        </div>

        <div v-if="configStep === 'edit'" class="config-flow">
          <div class="config-devices-list">
            <div v-for="c in configData" :key="c.id" class="config-device-item">
              <div class="config-device-header" @click="toggleConfigExpand(c.id)">
                <span class="mono">{{ c.ip }}</span>
                <span :class="['config-status', c.ok ? 'ok' : 'err']">{{ c.ok ? '已读取' : '失败' }}</span>
                <span class="config-expand-icon">{{ configExpandedIds.includes(c.id) ? '▼' : '▶' }}</span>
              </div>
              <div v-if="configExpandedIds.includes(c.id)" class="config-content">
                <pre v-if="c.ok" class="config-pre">{{ c.config }}</pre>
                <span v-else class="config-error">{{ c.error }}</span>
              </div>
            </div>
          </div>
          <div class="config-regex-section">
            <p class="config-section-title">小白模式</p>
            <p class="config-hint">自动保留前面的主 JSON 配置，只替换后面的消息模板区，避免把设备配置改坏。</p>
            <button class="btn-confirm full-width" @click="previewCleanMessageTemplates" :disabled="loading">
              应用简洁消息模板（推荐）
            </button>
          </div>
          <div class="config-regex-section">
            <p class="config-section-title">正则替换规则</p>
            <textarea v-model="configPattern" class="form-textarea-full" rows="4" placeholder="正则表达式，例如：(?s)&quot;uip&quot;:\\s*\\[.*?\\]\\s*(?=,\\s*&quot;sysArgs&quot;)"></textarea>
            <textarea v-model="configReplacement" class="form-textarea-full" rows="5" placeholder="替换文本：只填写要替换进去的片段"></textarea>
            <input v-model="configFlags" class="form-input" placeholder="标志位：i 忽略大小写，m 多行，s 点号匹配换行" />
            <p class="config-hint">不要把开头主 JSON 替换成 {}。建议只匹配消息模板区或 uip 固定片段，先预览确认主 JSON 还完整。</p>
            <div class="config-btn-row">
              <button class="btn-cancel" @click="configStep = 'read'">上一步</button>
              <button class="btn-confirm" @click="previewConfig" :disabled="loading || !configPattern.trim()">预览替换</button>
            </div>
          </div>
        </div>

        <div v-if="configStep === 'preview'" class="config-flow">
          <div class="config-devices-list">
            <div v-for="p in configPreviewData" :key="p.id" class="config-device-item">
              <div class="config-device-header" @click="toggleConfigExpand(p.id)">
                <span class="mono">{{ p.ip }}</span>
                <span v-if="configMode === 'clean_message_templates'" class="config-status info">简洁模板</span>
                <span v-if="p.ok" :class="['config-status', p.changed ? 'warn' : 'ok']">{{ p.changed ? '有变更' : '无变更' }}</span>
                <span v-else class="config-status err">错误</span>
                <span class="config-expand-icon">{{ configExpandedIds.includes(p.id) ? '▼' : '▶' }}</span>
              </div>
              <div v-if="configExpandedIds.includes(p.id)" class="config-content">
                <div v-if="p.ok && p.changed" class="config-diff">
                  <div v-for="(line, idx) in diffLines(p.original, p.replaced)" :key="idx" :class="['diff-line', 'diff-' + line.type]">
                    <span class="diff-prefix">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</span>{{ line.text }}
                  </div>
                </div>
                <pre v-else-if="p.ok" class="config-pre">{{ p.original }}</pre>
                <span v-else class="config-error">{{ p.error }}</span>
              </div>
            </div>
          </div>
          <div class="config-btn-row">
            <button class="btn-cancel" @click="configStep = 'edit'">返回修改</button>
            <button class="btn-confirm danger-btn" @click="writeConfigs" :disabled="loading || !configPreviewData.filter(item => item.ok && item.changed).length">确认写入</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
