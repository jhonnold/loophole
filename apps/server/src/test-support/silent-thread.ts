// A thread that exits without answering, as a crash or process.exit would.
declare const self: Worker;

self.onmessage = () => {
  process.exit(3);
};
