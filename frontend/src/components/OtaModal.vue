<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>批量 OTA 升级</h3>
        <button class="modal-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <div v-if="results.length === 0" class="ota-check-section">
          <p>点击按钮检查选中设备的版本信息</p>
          <button class="btn-check" :disabled="loading" @click="emit('check')">
            {{ loading ? '正在检查...' : '检查版本' }}
          </button>
        </div>

        <div v-if="loading && results.length === 0" class="ota-loading">
          <p>正在检查版本...</p>
        </div>
        <div v-else-if="results.length > 0" class="ota-results">
          <div class="ota-summary">
            <span class="ota-updatable">{{ updatableCount }} 台可升级</span>
            <span class="ota-latest">{{ latestCount }} 台已是最新</span>
            <span class="ota-failed">{{ failedCount }} 台检查失败</span>
          </div>
          <div class="ota-list">
            <div v-for="r in results" :key="r.id" class="ota-item" :class="{ 'has-update': r.ok && r.hasUpdate, 'failed': !r.ok }">
              <div class="ota-ip">{{ r.ip }}</div>
              <div class="ota-version">
                <span v-if="r.ok && r.hasUpdate">
                  <span class="version-current">{{ r.currentVer || '-' }}</span>
                  <span class="version-arrow">→</span>
                  <span class="version-new">{{ r.newVer }}</span>
                </span>
                <span v-else-if="r.ok">已是最新: {{ r.currentVer || '-' }}</span>
                <span v-else class="version-error">{{ r.error || '检查失败' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" @click="emit('close')">关闭</button>
        <button class="btn-upgrade" :disabled="loading || upgrading || !updatableCount" @click="emit('upgrade')">
          {{ upgrading ? '升级中...' : '升级' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  results: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  upgrading: { type: Boolean, default: false }
})

const emit = defineEmits(['check', 'upgrade', 'close'])

const updatableCount = computed(() => props.results.filter(r => r.ok && r.hasUpdate).length)
const latestCount = computed(() => props.results.filter(r => r.ok && !r.hasUpdate).length)
const failedCount = computed(() => props.results.filter(r => !r.ok).length)
</script>
