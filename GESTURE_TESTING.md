# Gesture Drawing Test Protocol

Progressive testing strategy to verify Gemini's vision-based drawing accuracy.

## Prerequisites
1. Start agent: `cd agent && python tutor.py dev`
2. Start frontend: `cd frontend && npm run dev`
3. Open browser, join room
4. Enable screen sharing (so Gemini can see the canvas)

---

## Level 1: Basic Positioning (No Vision Required)

Test coordinate understanding without needing vision.

### Test 1.1: Center Circle
**Command:** "Draw a red circle in the exact center of the screen"
**Expected:** Circle at (500, 500) with default radius

### Test 1.2: Four Corners
**Commands:**
- "Draw a blue circle in the top-left corner"
- "Draw a green circle in the top-right corner"
- "Draw a yellow circle in the bottom-left corner"
- "Draw a red circle in the bottom-right corner"

**Expected Coordinates:**
- Top-left: ~(100, 100)
- Top-right: ~(900, 100)
- Bottom-left: ~(100, 900)
- Bottom-right: ~(900, 900)

### Test 1.3: Simple Arrow
**Command:** "Draw an arrow from the top-left to the bottom-right"
**Expected:** Arrow from ~(100, 100) to ~(900, 900)

---

## Level 2: Vision-Based Targeting (Static Content)

First, manually add content to canvas, then ask Gemini to annotate it.

### Test 2.1: Circle Existing Text
**Setup:**
1. You (manually) say: "Write the word VELOCITY in large text"
2. Agent writes text to canvas

**Test:** "Circle the word VELOCITY in red"
**Expected:** Gemini sees text location, draws circle around it

### Test 2.2: Arrow Between Two Items
**Setup:**
1. "Write F=ma on the left"
2. "Write a=F/m on the right"

**Test:** "Draw a blue arrow from the first equation to the second equation"
**Expected:** Arrow starts near F=ma, points to a=F/m

### Test 2.3: Box Around Content
**Setup:** "Show an image of a cat"
**Test:** "Draw a yellow box around the cat image"
**Expected:** Box encompasses the image bounds

---

## Level 3: Precision Testing

Verify coordinate accuracy.

### Test 3.1: Measurement Test
**Setup:** You draw a grid manually or use browser console:
```javascript
// In browser console - draw reference grid
for (let x = 0; x <= 1000; x += 100) {
  for (let y = 0; y <= 1000; y += 100) {
    console.log(`Point (${x}, ${y})`);
  }
}
```

**Test:** "Draw a circle at exactly x=300, y=400"
**Verification:** Check console logs to see if coordinates match

### Test 3.2: Multi-Step Annotation
**Setup:** "Draw three circles: one red, one blue, one green"
**Test:** "Now draw arrows connecting all three circles in order"
**Expected:** 3 arrows: red→blue, blue→green, green→red

---

## Level 4: Real-World Use Case

Actual tutoring scenario.

### Test 4.1: Math Lesson Annotation
**Setup:**
1. "Teach me about the quadratic formula"
2. Agent writes formula: x = (-b ± √(b²-4ac)) / 2a

**Test:** "Circle the discriminant" (should circle b²-4ac)
**Expected:** Accurate positioning around discriminant term

### Test 4.2: Diagram Annotation
**Setup:** "Draw a right triangle"
**Test:** "Draw an arrow pointing to the hypotenuse"
**Expected:** Arrow points to correct side

---

## Debug Commands

If gestures aren't appearing:

1. **Check logs:** `tail -f agent/tool_calls.log`
2. **Browser console:** Check for errors in frontend
3. **Verify tool call:** Look for `[TOOL] draw_circle: {...}` in logs
4. **Manual test:** In browser console:
   ```javascript
   // Manually trigger a gesture
   window.testGesture = () => {
     const editor = document.querySelector('[data-tldraw]')?.__editor;
     if (editor) {
       editor.createShapes([{
         type: 'tutor_gesture',
         x: 400, y: 300,
         props: { type: 'circle', w: 100, h: 100, color: 'red' }
       }]);
     }
   };
   testGesture();
   ```

---

## Success Criteria

✅ **Level 1:** Gemini understands coordinate system (0-1000)
✅ **Level 2:** Gemini can see canvas content and target it
✅ **Level 3:** Coordinates accurate within ±50 units (5% error margin)
✅ **Level 4:** Usable in real tutoring scenarios

## Known Issues to Watch For

1. **Vision not enabled:** If Gemini can't see content, check `video_enabled=True` in tutor.py
2. **Coordinate inversion:** If gestures appear in wrong quadrant, coordinate conversion issue
3. **No animation:** If shapes appear instantly, CSS animation not working
4. **Gestures off-screen:** Viewport/camera mismatch in coordinate conversion
