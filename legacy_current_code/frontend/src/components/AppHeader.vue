<template>
  <header class="header">
    <div class="header-left">
      <div class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
          <path d="M12 6a2 2 0 100 4 2 2 0 000-4zm-4 8a4 4 0 118 0v1H8v-1z" />
        </svg>
      </div>
      <div class="header-title">
        <h1>控制台</h1>
        <p>管理中心</p>
      </div>
    </div>
    <div class="header-right">
      <button class="header-btn primary" :disabled="scanning" @click="emit('scan')">
        {{ scanning ? '扫描中...' : '扫描' }}
      </button>
      <button class="header-btn" :disabled="loading" @click="emit('refresh')">刷新</button>
      <button class="header-btn logout" @click="emit('logout')">退出</button>
    </div>
  </header>
</template>

<script setup>
defineProps({
  loading: { type: Boolean, default: false },
  scanning: { type: Boolean, default: false }
})

const emit = defineEmits(['scan', 'refresh', 'logout'])
</script>
