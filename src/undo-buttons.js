'use strict';
  /* Wire undo/redo buttons here, after the bar HTML, so $('btnUndo')
     and $('btnRedo') are not null when addEventListener runs. */

  $('btnUndo').addEventListener('click', () => {
    if (!undoStack.length) return;
    haptic('select');
    const leaving = captureState();
    const snap = undoStack.pop(), bmp = undoBmps.pop();
    redoStack.push(leaving); redoBmps.push(bmp);
    if (redoStack.length > UNDO_MAX) { redoStack.shift(); redoBmps.shift(); }
    applyState(snap); refreshCompareRef();
    toast(undoStack.length ? 'Undone — ' + undoStack.length + ' more step' + (undoStack.length === 1 ? '' : 's') : 'Undone');
  });
  $('btnRedo').addEventListener('click', () => {
    if (!redoStack.length) return;
    haptic('select');
    const leaving = captureState();
    const snap = redoStack.pop(), bmp = redoBmps.pop();
    undoStack.push(leaving); undoBmps.push(bmp);
    if (undoStack.length > UNDO_MAX) { undoStack.shift(); undoBmps.shift(); }
    applyState(snap); refreshCompareRef();
    toast(redoStack.length ? 'Redone — ' + redoStack.length + ' more step' + (redoStack.length === 1 ? '' : 's') : 'Redone');
  });
