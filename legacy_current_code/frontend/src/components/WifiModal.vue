<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>批量配置 WiFi</h3>
        <button class="modal-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <input :value="ssid" class="form-input" placeholder="WiFi 名称 (SSID)" @input="emit('update:ssid', $event.target.value)" />
        <input :value="password" class="form-input" type="password" placeholder="WiFi 密码" autocomplete="off" @input="emit('update:password', $event.target.value)" />

        <div v-if="results.length > 0" class="preview-section">
          <h4>预览结果（不写入设备）：</h4>
          <div class="preview-list">
            <div v-for="result in results" :key="result.id" class="preview-item">
              <span class="preview-ip">{{ result.ip }}</span>
              <span class="preview-alias">{{ result.alias || '(无别名)' }}</span>
              <span class="preview-status">WiFi将改为: {{ result.new_wifi }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" @click="emit('close')">取消</button>
        <button class="btn-preview" :disabled="loading" @click="emit('preview')">预览</button>
        <button class="btn-confirm" :disabled="loading" @click="emit('apply')">确认执行</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  ssid: { type: String, default: '' },
  password: { type: String, default: '' },
  results: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['update:ssid', 'update:password', 'preview', 'apply', 'close'])
</script>
