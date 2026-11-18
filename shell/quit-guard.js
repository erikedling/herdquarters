// While packages install there is no main.js yet, and a plain quit would leave npm writing into node_modules.
function guardQuit({ app, dialog, win, controller }) {
  let asking = false;
  const onQuit = (e) => {
    e.preventDefault();
    if (asking || controller.signal.aborted) return;
    asking = true;
    dialog.showMessageBox(win, {
      type: 'question',
      message: 'Herdquarters is updating',
      detail: 'Stop the update and quit? Herdquarters keeps the version it had.',
      buttons: ['Keep updating', 'Stop and quit'],
      defaultId: 0,
      cancelId: 0,
    }).then(({ response }) => {
      asking = false;
      if (response === 1) controller.abort();
    }, () => { asking = false; });
  };
  app.on('before-quit', onQuit);
  return () => app.removeListener('before-quit', onQuit);
}

module.exports = { guardQuit };
