import { useNoticeStore } from '../stores'

// Thin adapter over the notice Pinia store plus the error-message extractor
// that every workflow used inline (axios error -> response.data.detail ->
// error.message -> fallback).
export function useNotice() {
  const noticeStore = useNoticeStore()
  const setNotice = (text, type = 'info') => noticeStore.set(text, type)
  const clearNotice = () => noticeStore.clear()
  const errText = (e, fallback) =>
    (e && e.response && e.response.data && e.response.data.detail) || (e && e.message) || fallback
  return { setNotice, clearNotice, errText }
}
