const url = 'https://www.cninfo.com.cn/new/hisAnnouncement/query';
const body = new URLSearchParams({
  pageNum: '1',
  pageSize: '5',
  column: 'szse',
  tabName: 'fulltext',
  plate: '',
  stock: '600519',
  searchkey: '',
  secid: '',
  category: '',
  trade: '',
  seDate: '2026-06-01~2026-06-17',
});

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);

try {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0',
      Referer: 'https://www.cninfo.com.cn/',
      Origin: 'https://www.cninfo.com.cn',
    },
    body,
    signal: controller.signal,
  });
  console.log('HTTP', resp.status);
  const json = await resp.json();
  const anns = json.announcements ?? [];
  console.log('announcements on page:', anns.length, 'totalAnnouncement:', json.totalAnnouncement);
  if (anns[0]) {
    console.log('sample:', {
      announcementId: anns[0].announcementId,
      secCode: anns[0].secCode,
      secName: anns[0].secName,
      title: String(anns[0].announcementTitle ?? '').slice(0, 50),
    });
  }
} catch (e) {
  console.error('CNINFO fetch failed:', e instanceof Error ? e.message : e);
} finally {
  clearTimeout(timer);
}
