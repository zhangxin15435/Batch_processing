#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
基于 twikit 的 Twitter 抓取脚本（通过私有接口，使用 cookie 登录态）。

用法：
  python server/src/twitter_fetch.py --keywords 关键词1,关键词2 --count 20

环境变量：
  - TWITTER_AUTH_TOKEN: 对应 cookie 中的 auth_token
  - TWITTER_CT0: 对应 cookie 中的 ct0（与 x-csrf-token 相同）

说明：
  - 输出为 JSON 数组，字段结构与后端存储统一：
    postId, platform, keyword, author, url, title, desc, published_at,
    likes, comments, shares, views, followers, fetched_at
"""

import os
import sys
import json
import argparse
import asyncio
from datetime import datetime, timezone

try:
    from twikit import Client
except Exception as e:
    # 以统一 JSON 错误输出，便于 Node 侧解析
    print(json.dumps({
        "error": "导入 twikit 失败，请先安装依赖: pip install twikit",
        "detail": str(e)
    }, ensure_ascii=False))
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Twitter 抓取（twikit）')
    parser.add_argument('--keywords', type=str, default='')
    parser.add_argument('--count', type=int, default=20)
    # 新增：排序模式，支持 latest/top（默认 latest，保持兼容）
    parser.add_argument('--mode', type=str, default='latest')
    return parser.parse_args()


def now_iso() -> str:
    """返回 UTC ISO8601 时间串。"""
    return datetime.now(timezone.utc).isoformat()


async def fetch_for_keyword(client: Client, keyword: str, limit: int, mode: str = 'latest') -> list:
    """按关键词抓取推文，最多 limit 条。
    mode: 'latest' 或 'top'（不区分大小写）。
    """
    items = []
    try:
        # 将前端/参数传入的模式规范化为 twikit 需要的枚举字符串
        product = 'Latest' if str(mode).lower() != 'top' else 'Top'
        results = await client.search_tweet(keyword, product)
        # 遍历分页，直到满足条数或无更多
        while len(items) < limit and results:
            for t in results:
                try:
                    tweet_id = getattr(t, 'id', '')
                    screen_name = getattr(getattr(t, 'user', None), 'screen_name', '') or \
                                  getattr(getattr(t, 'user', None), 'username', '') or ''
                    url = f"https://x.com/{screen_name}/status/{tweet_id}" if (screen_name and tweet_id) else ''
                    text = getattr(t, 'text', '') or ''
                    created_at = getattr(t, 'created_at', None)
                    favorite_count = getattr(t, 'favorite_count', 0) or 0
                    reply_count = getattr(t, 'reply_count', 0) or 0
                    retweet_count = getattr(t, 'retweet_count', 0) or 0
                    view_count = getattr(t, 'view_count', 0) or 0
                    followers = getattr(getattr(t, 'user', None), 'followers_count', 0) or 0

                    items.append({
                        'postId': f'twitter:{tweet_id}' if tweet_id else f'twitter:{keyword}:{len(items)}',
                        'platform': 'twitter',
                        'keyword': keyword,
                        'author': screen_name,
                        'url': url,
                        'title': text[:120],
                        'desc': text,
                        'published_at': created_at if isinstance(created_at, str) else (created_at.isoformat() + 'Z' if created_at else None),
                        'likes': int(favorite_count) if favorite_count is not None else 0,
                        'comments': int(reply_count) if reply_count is not None else 0,
                        'shares': int(retweet_count) if retweet_count is not None else 0,
                        'views': int(view_count) if view_count is not None else 0,
                        'followers': int(followers) if followers is not None else 0,
                        'fetched_at': now_iso()
                    })
                    if len(items) >= limit:
                        break
                except Exception:
                    # 单条容错，继续
                    continue
            if len(items) >= limit:
                break
            try:
                results = await results.next()
            except Exception:
                break
    except Exception:
        # 某关键词失败，返回已收集的部分
        pass
    return items


async def main_async(keywords: list[str], count: int, mode: str = 'latest') -> list:
    # 从环境变量读取 cookie 值
    auth_token = os.environ.get('TWITTER_AUTH_TOKEN') or os.environ.get('AUTH_TOKEN')
    ct0 = os.environ.get('TWITTER_CT0') or os.environ.get('CT0')

    if not auth_token or not ct0:
        return [{
            'error': '缺少 cookie（TWITTER_AUTH_TOKEN / TWITTER_CT0）',
            'detail': '请在环境变量中设置 TWITTER_AUTH_TOKEN 与 TWITTER_CT0'
        }]

    client = Client('en-US')

    # 直接设置 cookie，跳过登录
    try:
        client.set_cookies({'auth_token': auth_token, 'ct0': ct0}, clear_cookies=True)
    except Exception as e:
        return [{ 'error': '设置 cookie 失败', 'detail': str(e) }]

    # 汇总抓取 - 修复：每个关键词都获得完整的 count 条数，而不是平分
    all_items: list = []
    # 修改逻辑：每个关键词都应该获得完整的count条数，这样多个平台可以各自获得期望的条数
    for kw in keywords or []:
        part = await fetch_for_keyword(client, kw, count, mode)
        all_items.extend(part)

    # 若关键词为空或数据不足，尝试热门趋势作为回退（避免完全空）
    if not keywords or len(all_items) < 1:
        try:
            trends = await client.get_trends('trending')
            if trends:
                trend_kw = getattr(trends[0], 'name', '') or getattr(trends[0], 'query', '')
                if trend_kw:
                    all_items.extend(await fetch_for_keyword(client, trend_kw, count, mode))
        except Exception:
            pass

    # 去重并保持原有顺序，最后裁切到合理数量（多个关键词可能有重复内容）
    seen = set()
    unique_items = []
    for item in all_items:
        item_key = f"{item.get('url', '')}-{item.get('postId', '')}"
        if item_key not in seen:
            seen.add(item_key)
            unique_items.append(item)
    
    # 如果有多个关键词，返回更多数据；单个关键词则限制为count条
    max_return = count * max(1, len(keywords)) if keywords else count
    return unique_items[:max_return]


def main():
    # Windows 控制台可能默认 GBK，强制使用 UTF-8 以避免中文/多语种编码异常
    try:
        sys.stdout.reconfigure(encoding='utf-8')  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding='utf-8')  # type: ignore[attr-defined]
    except Exception:
        pass
    args = parse_args()
    keywords = [s.strip() for s in (args.keywords or '').split(',') if s.strip()]
    count = max(1, int(args.count or 20))
    mode = (args.mode or 'latest').lower()

    try:
        items = asyncio.run(main_async(keywords, count, mode))
    except Exception as e:
        print(json.dumps({'error': '运行异常', 'detail': str(e)}, ensure_ascii=False))
        return

    # 统一以 JSON 数组输出
    try:
        print(json.dumps(items, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': '序列化异常', 'detail': str(e)}, ensure_ascii=False))


if __name__ == '__main__':
    main()


