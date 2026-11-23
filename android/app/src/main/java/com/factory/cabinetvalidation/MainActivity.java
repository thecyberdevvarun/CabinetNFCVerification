package com.factory.cabinetvalidation;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.net.http.SslError;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Full-screen WebView that loads the Cabinet Validation web app and reads NFC cards natively.
 * Each card tap is sent to the page as window.__onNativeNfcTag({uid, serial}).
 * Barcode scanning (Zebra DataWedge keystroke output) types into the focused web field as usual.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "cabinet_prefs";
    private static final String KEY_URL = "server_url";
    private static final Pattern SERIAL = Pattern.compile("\\d{20}");

    private WebView webView;
    private NfcAdapter nfcAdapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setBuiltInZoomControls(false);
        settings.setSupportZoom(false);

        webView.addJavascriptInterface(new Bridge(), "AndroidNfc");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Allow the self-signed certificate only for the configured server.
                String configured = Uri.parse(savedUrl()).getHost();
                String requested = Uri.parse(error.getUrl()).getHost();
                if (configured != null && configured.equals(requested)) handler.proceed();
                else handler.cancel();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showErrorPage();
            }
        });

        nfcAdapter = NfcAdapter.getDefaultAdapter(this);

        if (savedUrl().isEmpty()) promptForServer(false);
        else webView.loadUrl(savedUrl());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            nfcAdapter.enableReaderMode(
                    this,
                    this::onTag,
                    NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B
                            | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V,
                    null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (nfcAdapter != null) {
            try { nfcAdapter.disableReaderMode(this); } catch (Exception ignored) { }
        }
    }

    // ---------- NFC ----------
    private void onTag(Tag tag) {
        String uid = toHex(tag.getId());
        String serial = null;

        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            serial = findSerial(ndef.getCachedNdefMessage());
            if (serial == null) {
                try {
                    ndef.connect();
                    serial = findSerial(ndef.getNdefMessage());
                } catch (Exception ignored) {
                } finally {
                    try { ndef.close(); } catch (Exception ignored) { }
                }
            }
        }

        try {
            JSONObject json = new JSONObject();
            json.put("uid", uid);
            json.put("serial", serial == null ? JSONObject.NULL : serial);
            final String js = "window.__onNativeNfcTag && window.__onNativeNfcTag(" + json + ")";
            runOnUiThread(() -> webView.evaluateJavascript(js, null));
        } catch (Exception ignored) { }
    }

    // Same idea as the Python reader: find the 20-digit number in the NDEF text record.
    private static String findSerial(NdefMessage message) {
        if (message == null) return null;
        for (NdefRecord record : message.getRecords()) {
            byte[] payload = record.getPayload();
            if (payload == null) continue;
            Matcher m = SERIAL.matcher(new String(payload, StandardCharsets.ISO_8859_1));
            if (m.find()) return m.group();
        }
        return null;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) sb.append(':');
            sb.append(String.format("%02X", bytes[i]));
        }
        return sb.toString();
    }

    // ---------- Server address ----------
    private String savedUrl() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_URL, "");
    }

    private void promptForServer(boolean cancelable) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("http://192.168.1.50:5000");
        input.setText(savedUrl());

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("Server address")
                .setMessage("Enter the address of the Cabinet Validation server (the PC running the app).")
                .setView(input)
                .setCancelable(cancelable)
                .setPositiveButton("Connect", (dialog, which) -> {
                    String url = input.getText().toString().trim();
                    if (url.isEmpty()) { promptForServer(cancelable); return; }
                    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
                    getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
                    webView.loadUrl(url);
                });
        if (cancelable) builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void showErrorPage() {
        String html = "<html><body style='font-family:sans-serif;padding:32px;text-align:center'>"
                + "<h2>Cannot reach the server</h2>"
                + "<p>Check that the server PC is on, the app is running, and this device is on the same network.</p>"
                + "<p style='color:#666'>" + savedUrl() + "</p>"
                + "<button style='font-size:20px;padding:14px 28px;margin:8px' onclick='AndroidNfc.retry()'>Retry</button><br>"
                + "<button style='font-size:20px;padding:14px 28px;margin:8px' onclick='AndroidNfc.changeServer()'>Change server</button>"
                + "</body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    // ---------- JavaScript bridge (window.AndroidNfc) ----------
    private class Bridge {
        @JavascriptInterface
        public boolean isAvailable() { return nfcAdapter != null; }

        @JavascriptInterface
        public boolean isEnabled() { return nfcAdapter != null && nfcAdapter.isEnabled(); }

        @JavascriptInterface
        public void changeServer() { runOnUiThread(() -> promptForServer(true)); }

        @JavascriptInterface
        public void retry() { runOnUiThread(() -> webView.loadUrl(savedUrl())); }
    }
}
