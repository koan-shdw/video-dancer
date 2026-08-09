// caret geometry inside a <textarea> — the classic mirror-div trick: clone the textarea's text
// metrics into a hidden div, drop a marker at the index, measure it. Used to hang the @mention
// dropdown UNDER THE @ BEING TYPED instead of under/over the whole input box.
const MIRROR_PROPS = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textTransform', 'wordSpacing', 'textIndent', 'whiteSpace', 'wordBreak', 'overflowWrap'
] as const

export function caretPosInTextarea(ta: HTMLTextAreaElement, index: number): { x: number; y: number; lineH: number } {
  const div = document.createElement('div')
  const style = window.getComputedStyle(ta)
  for (const p of MIRROR_PROPS) div.style[p as 'width'] = style[p as 'width']
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.overflowWrap = 'break-word'
  div.textContent = ta.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = '​'
  div.appendChild(marker)
  document.body.appendChild(div)
  const lineH = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 18
  const x = marker.offsetLeft
  const y = marker.offsetTop - ta.scrollTop
  div.remove()
  return { x, y, lineH }
}
