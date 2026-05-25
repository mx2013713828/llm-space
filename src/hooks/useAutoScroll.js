import { useRef, useEffect } from 'react';

/**
 * useAutoScroll — 自动滚动 Hook
 *
 * 当消息列表更新时自动滚动到底部（仅在 trajectory tab 激活时触发）。
 *
 * @param {Array} messages - 消息列表，变化时触发滚动
 * @param {string} activeRightTab - 当前激活的右侧 Tab
 * @returns {{ chatEndRef: React.RefObject, scrollContainerRef: React.RefObject }}
 */
export function useAutoScroll(messages, activeRightTab) {
  const chatEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const prevLengthRef = useRef(messages.length);

  useEffect(() => {
    if (activeRightTab === 'trajectory') {
      const container = scrollContainerRef.current;
      if (!container) return;

      // Check if user is already near the bottom (within 150px)
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 150;
      // Check if the last message is a new message sent by user
      const isNewUserMessage = messages.length > prevLengthRef.current && messages[messages.length - 1]?.role === 'user';
      
      prevLengthRef.current = messages.length;

      if (isNearBottom || isNewUserMessage) {
        setTimeout(() => {
          chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      }
    }
  }, [messages, activeRightTab]);

  return { chatEndRef, scrollContainerRef };
}
