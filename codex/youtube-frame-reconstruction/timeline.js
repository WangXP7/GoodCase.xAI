// All boundaries are integer frame indices. Edit sourceStart/sourceEnd to reorder shots.
// Every source frame is a lossless asset from the publicly available reference.
window.FILM = {
  width: 1920, height: 1080, fps: 25, frames: 500,
  framePath: i => `assets/frames/${String(i).padStart(4,'0')}.webp`,
  audio: 'assets/soundtrack.wav',
  source: 'https://www.youtube.com/watch?v=1f13Bl1sYkw',
  reference: 'https://www.bilibili.com/video/BV1Gqhn64EqS/',
  mode: 'lossless-reference-frame-reconstruction',
  // Editable overlays are composited after the source frame. Source lettering is baked into assets.
  overlays: [], // e.g. {start:0,end:25,text:'Example',x:960,y:140,size:48,color:'#fff'}
  shots: [0,31,57,83,94,100,106,119,134,147,161,176,189,203,218,236,244,255,267,275,285,293,301,312,319,325,333,341,348,356,362,369,376,383,389,394,399]
    .map((start,i,a)=>({id:i+1, sourceStart:start,sourceEnd:a[i+1]??500}))
};
