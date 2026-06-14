<template>
  <div class="stats-grid">
    <div class="stat-card online">
      <div class="stat-icon" aria-hidden="true"><span class="stat-dot stat-dot-online"></span></div>
      <div class="stat-info">
        <div class="stat-value">{{ online }}</div>
        <div class="stat-label">在线</div>
      </div>
    </div>
    <div class="stat-card offline">
      <div class="stat-icon" aria-hidden="true"><span class="stat-dot stat-dot-offline"></span></div>
      <div class="stat-info">
        <div class="stat-value">{{ offline }}</div>
        <div class="stat-label">离线</div>
      </div>
    </div>
    <div class="stat-card total">
      <div class="stat-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2zm-5 19a1 1 0 110-2 1 1 0 010 2zm5-4H7V5h10v12z"/></svg>
      </div>
      <div class="stat-info">
        <div class="stat-value">{{ total }}</div>
        <div class="stat-label">设备</div>
      </div>
    </div>
    <div class="stat-card sim">
      <div class="stat-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H9l-6 6v10a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-2 14H7v-2h10v2zm0-4H7v-2h10v2zm0-4h-4V6h4v3z"/></svg>
      </div>
      <div class="stat-info">
        <div class="stat-value">{{ simCount }}</div>
        <div class="stat-label">SIM卡</div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  online: { type: Number, default: 0 },
  offline: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  simCount: { type: Number, default: 0 }
})
</script>
