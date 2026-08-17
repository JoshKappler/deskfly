// Prints JSON ledges the fly can land on: visible window edges (occlusion
// subtracted) plus text-input rectangles of the frontmost app when the app
// has Accessibility permission. Coordinates are global points, top-left origin.
import Cocoa
import ApplicationServices

struct Seg { var a: Double; var b: Double }

func subtract(_ seg: Seg, _ holes: [Seg]) -> [Seg] {
  var out = [seg]
  for h in holes {
    var next: [Seg] = []
    for s in out {
      if h.b <= s.a || h.a >= s.b { next.append(s); continue }
      if h.a > s.a { next.append(Seg(a: s.a, b: h.a)) }
      if h.b < s.b { next.append(Seg(a: h.b, b: s.b)) }
    }
    out = next
  }
  return out
}

func frameOf(_ el: AXUIElement) -> CGRect? {
  var posRef: CFTypeRef?
  var sizeRef: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posRef) == .success,
        AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
        let pv = posRef, let sv = sizeRef,
        CFGetTypeID(pv) == AXValueGetTypeID(), CFGetTypeID(sv) == AXValueGetTypeID()
  else { return nil }
  var p = CGPoint.zero
  var s = CGSize.zero
  AXValueGetValue(pv as! AXValue, .cgPoint, &p)
  AXValueGetValue(sv as! AXValue, .cgSize, &s)
  return CGRect(origin: p, size: s)
}

var ledges: [[String: Any]] = []

// window edges via CGWindowList, front-to-back, so earlier rects occlude later ones
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = (CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]]) ?? []
var occluders: [CGRect] = []
for w in list.prefix(60) {
  guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
  guard let b = w[kCGWindowBounds as String] as? [String: Double] else { continue }
  let wid = (w[kCGWindowNumber as String] as? Int) ?? 0
  if let alpha = w[kCGWindowAlpha as String] as? Double, alpha < 0.05 { continue }
  let r = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
  if r.width < 90 || r.height < 45 { continue }

  let hHoles = occluders.filter { $0.minY <= r.minY && $0.maxY >= r.minY }
    .map { Seg(a: Double($0.minX), b: Double($0.maxX)) }
  for s in subtract(Seg(a: Double(r.minX), b: Double(r.maxX)), hHoles) where s.b - s.a >= 40 {
    ledges.append(["dir": "h", "x0": s.a, "x1": s.b, "y": Double(r.minY), "kind": "window",
                   "wid": wid, "eid": 0, "ox": Double(r.minX)])
  }
  for x in [r.minX, r.maxX] {
    let vHoles = occluders.filter { $0.minX <= x && $0.maxX >= x }
      .map { Seg(a: Double($0.minY), b: Double($0.maxY)) }
    for s in subtract(Seg(a: Double(r.minY), b: Double(r.maxY)), vHoles) where s.b - s.a >= 40 {
      ledges.append(["dir": "v", "y0": s.a, "y1": s.b, "x": Double(x), "kind": "window",
                     "wid": wid, "eid": x == r.minX ? 2 : 3, "ox": Double(r.minY)])
    }
  }
  occluders.append(r)
}

// text inputs in the frontmost app's focused window
let inputRoles: Set<String> = ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"]
if AXIsProcessTrusted(), let front = NSWorkspace.shared.frontmostApplication {
  let axApp = AXUIElementCreateApplication(front.processIdentifier)
  var winRef: CFTypeRef?
  if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &winRef) == .success,
     let wv = winRef, CFGetTypeID(wv) == AXUIElementGetTypeID() {
    var queue: [AXUIElement] = [wv as! AXUIElement]
    var visited = 0
    while !queue.isEmpty && visited < 600 {
      let el = queue.removeFirst()
      visited += 1
      var roleRef: CFTypeRef?
      AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &roleRef)
      let role = (roleRef as? String) ?? ""
      if inputRoles.contains(role) {
        if let r = frameOf(el), r.width >= 60, r.height >= 12, r.width <= 1400 {
          ledges.append(["dir": "h", "x0": Double(r.minX) + 3, "x1": Double(r.maxX) - 3,
                         "y": Double(r.minY), "kind": "input",
                         "wid": Int(r.width.rounded()), "eid": 4, "ox": Double(r.minX) + 3])
        }
        continue
      }
      var kidsRef: CFTypeRef?
      if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &kidsRef) == .success,
         let kids = kidsRef as? [AXUIElement] {
        queue.append(contentsOf: kids.prefix(24))
      }
    }
  }
}

let data = try! JSONSerialization.data(withJSONObject: ["ledges": ledges])
FileHandle.standardOutput.write(data)
