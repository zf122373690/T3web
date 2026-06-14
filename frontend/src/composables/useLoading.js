import { ref } from 'vue'

// Shared "something is in flight" spinner flag used by every modal and toolbar
// button. A module-level singleton so App.vue and the workflow composables
// (messaging / wifi / ota / config / detail) all drive the same global ref.
const loading = ref(false)

export function useLoading() {
  return loading
}
