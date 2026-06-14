<template>
  <div class="login-container">
    <div class="login-box">
      <div class="login-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
          <path d="M12 6a2 2 0 100 4 2 2 0 000-4zm-4 8a4 4 0 118 0v1H8v-1z" />
        </svg>
      </div>
      <h1 class="login-title">控制台</h1>
      <p class="login-subtitle">请输入密码登录系统</p>
      <div class="login-form">
        <input
          :value="password"
          class="login-input"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
          @input="emit('update:password', $event.target.value)"
          @keyup.enter="emit('login')"
        />
        <button class="login-button" :disabled="loading" @click="emit('login')">
          <span v-if="loading">验证中...</span>
          <span v-else>登 录</span>
        </button>
      </div>
      <div v-if="notice.text" class="login-notice" :class="'notice-' + notice.type">
        {{ notice.text }}
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  password: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  notice: { type: Object, default: () => ({ text: '', type: 'info' }) }
})

const emit = defineEmits(['update:password', 'login'])
</script>
