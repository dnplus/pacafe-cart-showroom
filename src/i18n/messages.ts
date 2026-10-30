// Each row is [English key, 繁體中文].
export const messages = [
  ['Recording', '錄影中'],
  ['Play', '播放'],
  ['Pause', '暫停'],
  ['Timeline', '時間軸'],
  ['Play from the start', '從頭播放'],
  ['Captions', '字幕'],
  ['A · host', 'A 主播'],
  ['B · cutaways', 'B 補充'],
  ['Narration', '旁白'],
  ['Playhead', '播放位置'],
  ['Narration comes from your editor\'s computer.', '旁白會從剪輯師的電腦傳上來。'],
  ['The barista is getting into place…', '咖啡師正在就位…'],
  ['The camera needs 3D, which this device cannot show.', '這台裝置畫不出立體小屋，鏡頭暫時看不到。'],
  ['Your shared cafe', '你與夥伴的小屋'],
  ['Opening the curtains…', '正在拉開窗簾…'],
  ['Reset room view', '重設房間視角'],
  ['Drag to pan, right-drag to rotate and scroll to zoom. On touch screens, use two fingers to zoom and pan.', '桌面用左鍵拖曳平移、右鍵拖曳旋轉、滾輪縮放；觸控用雙指縮放和平移。'],
  ['Camera controls', '鏡頭控制'],
  ['Counter: nothing waiting', '吧台：目前沒有東西'],
  ['Barista', '咖啡師'],
] as const;
export type TextKey = typeof messages[number][0];
