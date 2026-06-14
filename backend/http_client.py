"""HTTP客户端 - 用于与ESP32-C3设备通信.

Windows/Linux兼容: 共享httpx客户端.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import httpx

from backend.config import TIMEOUT, CONCURRENCY

logger = logging.getLogger("sms-forwarder")

# 共享的httpx客户端和线程池
_sync_client: Optional[httpx.Client] = None
_shared_executor: Optional[ThreadPoolExecutor] = None


def init_runtime() -> tuple[httpx.Client, ThreadPoolExecutor]:
    """初始化共享的HTTP客户端和线程池"""
    global _sync_client, _shared_executor
    
    if _sync_client is None:
        _sync_client = httpx.Client(
            timeout=TIMEOUT,
            limits=httpx.Limits(
                max_connections=CONCURRENCY,
                max_keepalive_connections=CONCURRENCY // 2,
            ),
        )
        logger.info("HTTP client initialized (timeout=%.1fs, max_connections=%d)", TIMEOUT, CONCURRENCY)
    
    if _shared_executor is None:
        _shared_executor = ThreadPoolExecutor(max_workers=CONCURRENCY, thread_name_prefix="sf-http-")
        logger.info("Thread pool initialized (max_workers=%d)", CONCURRENCY)
    
    return _sync_client, _shared_executor


def shutdown_runtime() -> None:
    """关闭共享的HTTP客户端和线程池"""
    global _sync_client, _shared_executor
    
    if _sync_client is not None:
        _sync_client.close()
        _sync_client = None
        logger.info("HTTP client shut down")
    
    if _shared_executor is not None:
        _shared_executor.shutdown(wait=True)
        _shared_executor = None
        logger.info("Thread pool shut down")


def get_sync_client() -> httpx.Client:
    """获取共享的HTTP客户端"""
    global _sync_client
    if _sync_client is None:
        init_runtime()
    return _sync_client


def get_shared_executor() -> ThreadPoolExecutor:
    """获取共享的线程池"""
    global _shared_executor
    if _shared_executor is None:
        init_runtime()
    return _shared_executor