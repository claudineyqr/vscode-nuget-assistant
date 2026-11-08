const vscodeApi = { postMessage: jest.fn() };
const acquireVsCodeApi = () => vscodeApi;
Object.defineProperty(window, 'acquireVsCodeApi', { value: acquireVsCodeApi });
