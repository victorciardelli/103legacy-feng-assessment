import React from "react";
import ReactDOM from "react-dom/client";
import { Route, Switch } from "wouter";
import { HomePage } from "./pages/HomePage";
import { UploadPage } from "./pages/UploadPage";
import { DashboardPage } from "./pages/DashboardPage";
import "./index.css";

function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/upload/:projectId" component={UploadPage} />
      <Route path="/dashboard/:projectId" component={DashboardPage} />
      <Route><div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Page not found</p></div></Route>
    </Switch>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
