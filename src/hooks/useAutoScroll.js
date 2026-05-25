import { useRef, useEffect } from 'react';

/**
 * useAutoScroll — 智能自动滚动 Hook
 *
 * 规则：
 * 1. 仅当 messages 数组长度增加（新消息到来）时才考虑滚动，避免 streaming delta 触发
 * 2. 如果用户已经手动向上滚动（userScrolledAway = true），不强制拖底
 * 3. 用户发出新消息（user role）时，强制滚到底部并重置 userScrolledAway
 *
 * @param {Array} messages - 消息列表
 * @param {string} activeRightTab - 当前激活的右侧 Tab
 * @returns {{ chatEndRef, scrollContainerRef }}
 */
export function useAutoScroll(messages, activeRightTab) {
  const chatEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Track previous message count to detect new messages (not just content updates)
  const prevLengthRef = useRef(0);
  // Track whether user has scrolled away from the bottom
  const userScrolledAwayRef = useRef(false);
  // Ignore the next scroll event caused by our own programmatic scroll
  const programmaticScrollRef = useRef(false);

  // Listen to scroll events to detect user manual scrolling
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // If this scroll was triggered by us, ignore it
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      // If user scrolled more than 80px away from bottom, mark as scrolled away
      userScrolledAwayRef.current = distanceFromBottom > 80;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []); // Only attach once

  useEffect(() => {
    if (activeRightTab !== 'trajectory') return;

    const prevLength = prevLengthRef.current;
    const newLength = messages.length;
    prevLengthRef.current = newLength;

    // No new messages (just content streaming updates on existing messages) — do not scroll
    if (newLength <= prevLength) return;

    // Check if the newest message is from the user (user pressed send)
    const lastMsg = messages[newLength - 1];
    const isNewUserMessage = lastMsg?.role === 'user';

    if (isNewUserMessage) {
      // User just sent a message: force scroll to bottom and reset flag
      userScrolledAwayRef.current = false;
    }

    // If user has scrolled away, respect their position
    if (userScrolledAwayRef.current) return;

    // Scroll to bottom
    programmaticScrollRef.current = true;
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, [messages.length, activeRightTab]); // Only trigger on length change, not content updates

  return { chatEndRef, scrollContainerRef };
}
