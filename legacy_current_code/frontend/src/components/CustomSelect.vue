<template>
  <div class="custom-select" ref="selectRef">
    <div class="select-trigger" @click="toggle" :class="{ open: isOpen }">
      <span class="select-value">{{ selectedLabel || placeholder }}</span>
      <span class="select-arrow">{{ isOpen ? '▲' : '▼' }}</span>
    </div>
    <div class="select-dropdown" v-if="isOpen">
      <div
        class="select-option"
        :class="{ active: !value }"
        @click="select('')"
      >
        {{ placeholder }}
      </div>
      <div
        v-for="opt in options"
        :key="opt.value"
        class="select-option"
        :class="{ active: value === opt.value }"
        @click="select(opt.value)"
      >
        {{ opt.label }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  options: { type: Array, default: () => [] },
  value: { type: String, default: '' },
  placeholder: { type: String, default: '请选择' }
})

const emit = defineEmits(['update:value'])

const isOpen = ref(false)
const selectRef = ref(null)

const selectedLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.value)
  return opt ? opt.label : ''
})

function toggle() {
  isOpen.value = !isOpen.value
}

function select(val) {
  emit('update:value', val)
  isOpen.value = false
}

function handleClickOutside(e) {
  if (selectRef.value && !selectRef.value.contains(e.target)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))
</script>

<style scoped>
.custom-select {
  position: relative;
  width: 100%;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-dark, #000);
  border: 1px solid var(--border, #38383a);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary, #fff);
  transition: border-color 0.15s;
}

.select-trigger.open {
  border-color: var(--primary, #0a84ff);
}

.select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-arrow {
  font-size: 10px;
  color: var(--text-secondary, #8e8e93);
  margin-left: 8px;
  flex-shrink: 0;
}

.select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-card, #1c1c1e);
  border: 1px solid var(--border, #38383a);
  border-radius: 8px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.select-option {
  padding: 10px 12px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary, #fff);
  transition: background 0.1s;
}

.select-option:hover {
  background: var(--bg-card-hover, #2c2c2e);
}

.select-option.active {
  background: var(--primary, #0a84ff);
  color: #fff;
}
</style>
