import { Component, ErrorInfo, ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

class DesktopErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("桌面界面渲染异常", error, info); }
  render() {
    if (this.state.failed) return <main className="desktop-fallback"><section><strong>界面发生异常，当前数据没有被修改。</strong><p>请重新打开应用；若问题持续，保留复现步骤和截图。</p><button onClick={() => window.location.reload()}>重新加载界面</button></section></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><DesktopErrorBoundary><App /></DesktopErrorBoundary></StrictMode>);
