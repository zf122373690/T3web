<template>
  <div v-if="pages > 1 || total > pageSize" class="pagination">
    <span class="pagination-info">共 {{ total }} 条 · 第 {{ page }} / {{ pages || 1 }} 页</span>
    <div class="pagination-controls">
      <button
        class="pg-btn"
        :disabled="page <= 1"
        @click="emit('change', 1)"
      >首页</button>
      <button
        class="pg-btn"
        :disabled="page <= 1"
        @click="emit('change', page - 1)"
      >上一页</button>
      <span class="pg-current">{{ page }}</span>
      <button
        class="pg-btn"
        :disabled="page >= pages"
        @click="emit('change', page + 1)"
      >下一页</button>
      <button
        class="pg-btn"
        :disabled="page >= pages"
        @click="emit('change', pages)"
      >末页</button>
    </div>
  </div>
</template>

<script setup>
// FIX(P2#7): minimal pagination control. Stays simple on purpose -- we
// don't render every page number because the dashboard rarely sees more
// than a few pages, and the home/end + prev/next combo is enough for the
// 99% case. If page-jump becomes necessary we'll add an input here.
defineProps({
  page: { type: Number, required: true },
  pages: { type: Number, default: 0 },
  pageSize: { type: Number, default: 100 },
  total: { type: Number, default: 0 }
})
const emit = defineEmits(['change'])
</script>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-top: 16px;
  background: var(--card);
  border-radius: 8px;
  flex-wrap: wrap;
  gap: 12px;
}
.pagination-info { color: var(--text-2); font-size: 13px; }
.pagination-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pg-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.pg-btn:hover:not(:disabled) { background: var(--primary); color: white; border-color: var(--primary); }
.pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pg-current {
  background: var(--primary);
  color: white;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
}
</style>
