let source = null;
export function setGameData(data) { source = data; }
export function getData() {
  if (!source) throw Error('SI 运行数据尚未注入 AUE 内容层');
  return source;
}
