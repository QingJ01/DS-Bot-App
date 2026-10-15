export function backgroundNotificationLink(url: string | null): Record<string, unknown> | null {
  if (!url) return null;
  try {
    const value = new URL(url);
    if (value.protocol !== 'dsbot:' || value.hostname !== 'notification' || value.username || value.password || !['', '/'].includes(value.pathname)) return null;
    const serverId = value.searchParams.get('serverId'), conversationId = value.searchParams.get('conversationId');
    const id = value.searchParams.get('notificationId');
    if (!serverId || serverId.length > 128 || !conversationId || conversationId.length > 256 || !id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
    return {serverId, conversationId, notificationId:Number(id)};
  } catch { return null; }
}

export function notificationTransportLabel(platform: string, hasCloudConfig: boolean) {
  if (platform === 'android') return "Background reception needs no FCM or APNs. Optional cloud push can notify you when the app is not running.";
  if (platform === 'ios') return hasCloudConfig ? "Cloud push is available. Background reception only works during the time allowed by iOS." : "Background reception needs no push credentials. When iOS suspends the app, continued delivery requires APNs cloud push.";
  return "The browser preview includes a notification inbox. Use the native app for system notifications.";
}

export function notificationTitle(kind: string) {
  return kind === "reply" ? "New reply from your Bot" : kind === "question" ? "Your Bot has a question" : kind === "approval" ? "A tool needs your approval" : "DS Bot";
}

export async function markConversationNotificationsRead<T extends { id: number; conversationId: string; read: boolean }>(
  items: T[], conversationId: string | undefined, markRead: (ids: number[]) => Promise<unknown>,
): Promise<T[]> {
  if (!conversationId) return items;
  const ids = items.filter(item => !item.read && (item.conversationId === conversationId || conversationId === `bot:${item.conversationId}` || conversationId === `room:${item.conversationId}`)).map(item => item.id);
  if (!ids.length) return items;
  await markRead(ids);
  const read = new Set(ids);
  return items.map(item => read.has(item.id) ? { ...item, read: true } : item);
}
