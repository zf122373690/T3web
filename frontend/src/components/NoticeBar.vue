<template>
  <div v-if="notice.text" class="notice-bar" :class="'notice-' + notice.type">
    <span>{{ notice.text }}</span>
    <button class="notice-close" @click="emit('close')">×</button>
  </div>
</template>

<script setup>
defineProps({
  notice: { type: Object, default: () => ({ text: '', type: 'info' }) }
})

const emit = defineEmits(['close'])
</script>
