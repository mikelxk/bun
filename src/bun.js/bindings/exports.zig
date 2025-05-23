const JSC = bun.JSC;

const bun = @import("bun");
const std = @import("std");
const strings = bun.strings;
const default_allocator = bun.default_allocator;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const string = bun.string;
const JSValue = JSC.JSValue;
const String = bun.String;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;

// Re-export all the split-out types
pub const Exception = @import("Exception.zig").Exception;
pub const ErrorCode = @import("ErrorCode.zig").ErrorCode;
pub const ZigErrorType = @import("ZigErrorType.zig").ZigErrorType;
pub const NodePath = JSC.Node.Path;

// Re-export all the sink types
pub const JSArrayBufferSink = JSC.WebCore.ArrayBufferSink.JSSink;
pub const JSHTTPSResponseSink = JSC.WebCore.HTTPSResponseSink.JSSink;
pub const JSHTTPResponseSink = JSC.WebCore.HTTPResponseSink.JSSink;
pub const JSFileSink = JSC.WebCore.FileSink.JSSink;
pub const JSNetworkSink = JSC.WebCore.NetworkSink.JSSink;

// Re-export WebSocket client types
pub const WebSocketHTTPClient = @import("../../http/websocket_http_client.zig").WebSocketHTTPClient;
pub const WebSocketHTTPSClient = @import("../../http/websocket_http_client.zig").WebSocketHTTPSClient;
pub const WebSocketClient = @import("../../http/websocket_http_client.zig").WebSocketClient;
pub const WebSocketClientTLS = @import("../../http/websocket_http_client.zig").WebSocketClientTLS;

comptime {
    WebSocketClient.exportAll();
    WebSocketClientTLS.exportAll();
    WebSocketHTTPClient.exportAll();
    WebSocketHTTPSClient.exportAll();
}

// Re-export the Errorable type and common instances
pub const Errorable = @import("Errorable.zig").Errorable;
pub const ResolvedSource = @import("ResolvedSource.zig").ResolvedSource;
pub const SourceProvider = @import("SourceProvider.zig").SourceProvider;

// Re-export error and event types
pub const JSErrorCode = @import("JSErrorCode.zig").JSErrorCode;
pub const EventType = @import("EventType.zig").EventType;
pub const JSRuntimeType = @import("JSRuntimeType.zig").JSRuntimeType;
pub const ZigStackFrameCode = @import("ZigStackFrameCode.zig").ZigStackFrameCode;

// Re-export Process
pub const Process = @import("Process.zig").Process;
comptime {
    _ = Process.getTitle;
    _ = Process.setTitle;
}

// Re-export stack trace related types
pub const ZigStackTrace = @import("ZigStackTrace.zig").ZigStackTrace;
pub const ZigStackFrame = @import("ZigStackFrame.zig").ZigStackFrame;
pub const ZigStackFramePosition = @import("ZigStackFramePosition.zig").ZigStackFramePosition;
pub const ZigException = @import("ZigException.zig").ZigException;

pub const ErrorableResolvedSource = Errorable(ResolvedSource);
pub const ErrorableZigString = Errorable(ZigString);
pub const ErrorableJSValue = Errorable(JSValue);
pub const ErrorableString = Errorable(String);
pub const ConsoleObject = @import("../ConsoleObject.zig");

// Re-export type aliases
pub const BunTimer = JSC.API.Bun.Timer;
pub const Formatter = ConsoleObject.Formatter;
pub const HTTPServerRequestContext = JSC.API.HTTPServer.RequestContext;
pub const HTTPSSLServerRequestContext = JSC.API.HTTPSServer.RequestContext;
pub const HTTPDebugServerRequestContext = JSC.API.DebugHTTPServer.RequestContext;
pub const HTTPDebugSSLServerRequestContext = JSC.API.DebugHTTPSServer.RequestContext;
pub const BodyValueBuffererContext = JSC.WebCore.BodyValueBufferer;
pub const TestScope = @import("../test/jest.zig").TestScope;
