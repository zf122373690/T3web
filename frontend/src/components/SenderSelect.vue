<template>
  <CustomSelect :options="selectOptions" :value="value" @update:value="emit('update:value', $event)" placeholder="选择发送卡号" />
</template>

<script setup>
import { computed } from 'vue'
import CustomSelect from './CustomSelect.vue'

const props = defineProps({
  numbers: { type: Array, default: () => [] },
  value: { type: String, default: '' }
})

const emit = defineEmits(['update:value'])

const selectOptions = computed(() =>
  props.numbers.map(n => ({
    value: String(n.deviceId) + '|' + String(n.slot),
    label: n.number + ' (' + (n.operator || '未知') + ')'
  }))
)
</script>
