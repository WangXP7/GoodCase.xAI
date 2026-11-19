// The buildings everybody knows, by area: [name, longitude, latitude] of a point inside each. In the abstract
// mode (materials.js) the city is a plain model and these keep their own look, as on a tourist map.
// (A building of several parts needs a point in each part that is to keep its look.)
export const LANDMARKS = {
  tokyo: [
    ['Tokyo Station', 139.76625, 35.68125], ['Tokyo Station', 139.76655, 35.68215], ['Tokyo Station', 139.76600, 35.68040],
    ['JP Tower (KITTE)', 139.76490, 35.67975], ['Marunouchi Building', 139.76395, 35.68115], ['Shin-Marunouchi Building', 139.76425, 35.68255],
    ['Tokyo International Forum', 139.76390, 35.67690], ['Mitsubishi Ichigokan', 139.76335, 35.67835],
  ],
  shiba: [['Zojo-ji', 139.74835, 35.65745], ['Zojo-ji gate', 139.75010, 35.65740]],
  shibuya: [
    ['Shibuya 109', 139.69875, 35.65955], ['QFRONT', 139.70055, 35.65980], ['Shibuya Scramble Square', 139.70225, 35.65840],
    ['Shibuya Hikarie', 139.70345, 35.65905], ['Shibuya Stream', 139.70290, 35.65700], ['Shibuya Parco', 139.69890, 35.66205],
  ],
  shinjuku: [
    ['Tokyo Metropolitan Government Building', 139.69170, 35.68960], ['Tokyo Metropolitan Government Building No. 2', 139.69175, 35.68805],
    ['Mode Gakuen Cocoon Tower', 139.69695, 35.69165], ['Shinjuku Park Tower', 139.69095, 35.68565], ['Sompo Japan Building', 139.69600, 35.69275],
    ['Keio Plaza Hotel', 139.69543, 35.69062],
  ],
  chiyoda: [
    ['Akihabara UDX', 139.77265, 35.70055], ['Yodobashi Akiba', 139.77485, 35.69870], ['Radio Kaikan', 139.77165, 35.69830],
    ['Kanda Myojin', 139.76790, 35.70200], ['Holy Resurrection Cathedral', 139.76560, 35.69810],
  ],
  chuo: [['Tsukiji Hongan-ji', 139.77220, 35.66650]],
  fujinomiya: [['Fujisan Hongu Sengen Taisha', 138.61000, 35.22750], ['Mt. Fuji World Heritage Centre', 138.61080, 35.22330], ['Fujinomiya City Hall', 138.62150, 35.22200]],
};
