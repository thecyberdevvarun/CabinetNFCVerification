package com.factory.cabinetvalidation;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Standalone Cabinet Validation app.
 *  - The web UI is bundled inside the APK (assets/www) and shown in a full-screen WebView.
 *  - NFC cards are read natively and sent to the page as window.__onNativeNfcTag({uid, serial}).
 *  - Saving goes straight from the device to SQL Server (JDBC). No PC server or Node backend is needed.
 *  - Barcode scanning (Zebra DataWedge keystroke output) types into the focused web field as usual.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "cabinet_prefs";
    private static final String APP_HOST = "appassets.local";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";

    private static final Pattern SERIAL = Pattern.compile("\\d{20}");
    private static final Pattern BARCODE = Pattern.compile("^F4\\d{13}$");
    private static final Pattern CARD_ID = Pattern.compile("^[0-9A-F]{2}(?::[0-9A-F]{2})*$");
    private static final Pattern NFC_PAYLOAD =
            Pattern.compile("^(?:[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2})*;)?(\\d{20})$");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
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
            // Serve the bundled web app from the APK (assets/www) under a private https address.
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!APP_HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
                try {
                    InputStream in = getAssets().open("www" + path);
                    return new WebResourceResponse(mimeFor(path), "UTF-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                            Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
            }
        });

        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        webView.loadUrl(START_URL);

        if (!isConfigured()) showSettings();
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

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdown();
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
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

    // ---------- Database settings ----------
    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean isConfigured() {
        return !prefs().getString("db_host", "").isEmpty() && !prefs().getString("db_user", "").isEmpty();
    }

    private EditText addField(LinearLayout parent, String hint, String value, int inputType) {
        EditText edit = new EditText(this);
        edit.setHint(hint);
        edit.setText(value);
        edit.setInputType(inputType);
        edit.setSingleLine(true);
        parent.addView(edit);
        return edit;
    }

    private void showSettings() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad / 2, pad, 0);

        final EditText host = addField(layout, "SQL Server address (e.g. 192.168.1.50 or PC\\SQLEXPRESS)",
                prefs().getString("db_host", ""), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        final EditText port = addField(layout, "Port (default 1433)",
                prefs().getString("db_port", "1433"), InputType.TYPE_CLASS_NUMBER);
        final EditText name = addField(layout, "Database name",
                prefs().getString("db_name", "CabinetValidation"), InputType.TYPE_CLASS_TEXT);
        final EditText user = addField(layout, "SQL login user",
                prefs().getString("db_user", ""), InputType.TYPE_CLASS_TEXT);
        final EditText pass = addField(layout, "SQL login password",
                prefs().getString("db_pass", ""), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout);

        new AlertDialog.Builder(this)
                .setTitle("Database settings")
                .setView(scroll)
                .setPositiveButton("Save & test", (dialog, which) -> {
                    prefs().edit()
                            .putString("db_host", host.getText().toString().trim())
                            .putString("db_port", port.getText().toString().trim())
                            .putString("db_name", name.getText().toString().trim())
                            .putString("db_user", user.getText().toString().trim())
                            .putString("db_pass", pass.getText().toString())
                            .apply();
                    toast("Testing database connection...");
                    executor.execute(() -> {
                        String message;
                        try (Connection ignored = openConnection()) {
                            message = "Database connected.";
                        } catch (Exception e) {
                            message = "Connection failed: " + shorten(e.getMessage());
                        }
                        toast(message);
                    });
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void toast(final String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
    }

    private static String shorten(String text) {
        if (text == null) return "unknown error";
        return text.length() > 160 ? text.substring(0, 160) + "..." : text;
    }

    // ---------- Database ----------
    private String jdbcUrl() {
        String host = prefs().getString("db_host", "");
        String port = prefs().getString("db_port", "1433");
        String name = prefs().getString("db_name", "CabinetValidation");
        String instance = "";
        int slash = host.indexOf('\\');
        if (slash >= 0) {
            instance = host.substring(slash + 1);
            host = host.substring(0, slash);
        }
        StringBuilder url = new StringBuilder("jdbc:jtds:sqlserver://").append(host);
        if (instance.isEmpty()) url.append(':').append(port.isEmpty() ? "1433" : port);
        url.append('/').append(name);
        if (!instance.isEmpty()) url.append(";instance=").append(instance);
        url.append(";loginTimeout=10;socketTimeout=20");
        return url.toString();
    }

    private Connection openConnection() throws Exception {
        Class.forName("net.sourceforge.jtds.jdbc.Driver");
        return DriverManager.getConnection(jdbcUrl(), prefs().getString("db_user", ""), prefs().getString("db_pass", ""));
    }

    private static String normalizeNfc(String value) {
        String text = value == null ? "" : value.trim();
        Matcher m = NFC_PAYLOAD.matcher(text);
        return m.matches() ? m.group(1) : text;
    }

    private static JSONObject result(boolean success, int status, String message) {
        JSONObject json = new JSONObject();
        try {
            json.put("success", success);
            json.put("status", status);
            json.put("message", message);
        } catch (Exception ignored) { }
        return json;
    }

    // Same rules as the Node backend, then INSERT into dbo.cabinet_nfc_verification.
    private JSONObject doSave(String payloadJson) {
        try {
            JSONObject in = new JSONObject(payloadJson);
            String barcode = in.optString("foamingBarcode", "").trim().toUpperCase();
            String inner = normalizeNfc(in.optString("innerNfc", ""));
            String outer = normalizeNfc(in.optString("outerNfc", ""));
            String innerMac = in.optString("innerNfcMac", "").trim().toUpperCase();
            String outerMac = in.optString("outerNfcMac", "").trim().toUpperCase();
            String area = in.optString("area", "");

            // The foaming barcode is scanned only in Freezer Post; Freezer Pre stores it blank (NULL).
            if (area.equals("FREEZER_POST") && !BARCODE.matcher(barcode).matches())
                return result(false, 400, "Invalid Foaming Barcode. Expected F4 followed by 13 digits.");
            if (inner.isEmpty() || outer.isEmpty())
                return result(false, 400, "Both NFC values are required.");
            if (!inner.equals(outer))
                return result(false, 400, "Inner NFC and Outer NFC do not match.");
            if ((!innerMac.isEmpty() && (!CARD_ID.matcher(innerMac).matches() || innerMac.length() > 50))
                    || (!outerMac.isEmpty() && (!CARD_ID.matcher(outerMac).matches() || outerMac.length() > 50)))
                return result(false, 400, "Invalid NFC card ID format.");
            if (area.equals("FREEZER_PRE") && outerMac.isEmpty())
                return result(false, 400, "Outer NFC card ID (UID) is missing. Tap the Outer card with the NFC reader.");
            if (!area.equals("FREEZER_PRE") && !area.equals("FREEZER_POST"))
                return result(false, 400, "Invalid area. Select Freezer Pre or Freezer Post.");
            if (!isConfigured())
                return result(false, 500, "Database is not set up. Tap \"Database settings\" on the first screen.");

            try (Connection connection = openConnection()) {
                if (area.equals("FREEZER_PRE")) {
                    String duplicate = findUsedNfc(connection, outerMac + "/" + outer);
                    if (duplicate != null) return result(false, 409, duplicate);
                }
                try (PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO dbo.cabinet_nfc_verification (foaming_barcode, inner_ncf, outer_nfc, inner_nfc_mac, outer_nfc_mac, area) VALUES (?, ?, ?, ?, ?, ?)")) {
                    if (area.equals("FREEZER_POST")) statement.setString(1, barcode);
                    else statement.setNull(1, Types.VARCHAR);
                    statement.setString(2, inner);
                    statement.setString(3, outer);
                    if (innerMac.isEmpty()) statement.setNull(4, Types.VARCHAR); else statement.setString(4, innerMac);
                    if (outerMac.isEmpty()) statement.setNull(5, Types.VARCHAR); else statement.setString(5, outerMac);
                    statement.setString(6, area);
                    statement.executeUpdate();
                }
            }
            return result(true, 201, "Cabinet saved successfully.");
        } catch (SQLException e) {
            // 2627 / 2601 = unique constraint violation (foaming_barcode + area)
            if (e.getErrorCode() == 2627 || e.getErrorCode() == 2601) {
                String label = payloadJson.contains("FREEZER_POST") ? "Freezer Post" : "Freezer Pre";
                return result(false, 409, "This Foaming Barcode has already been verified in " + label + ".");
            }
            return result(false, 500, "Database error: " + shorten(e.getMessage()));
        } catch (Exception e) {
            return result(false, 500, "Cannot reach the database. Check Wi-Fi and Database settings. (" + shorten(e.getMessage()) + ")");
        }
    }

    // Freezer Pre only: the outer card's "<card ID>/<card value>" is stored in MaterialBarcode.Serial2 when a card is
    // used on a body. If it is already there, this NFC card was used before: return a message with the body Serial.
    private static String findUsedNfc(Connection connection, String serial2) throws SQLException {
        try (PreparedStatement check = connection.prepareStatement(
                "SELECT TOP 1 Serial FROM MaterialBarcode WHERE Serial2 = ?")) {
            check.setString(1, serial2);
            try (ResultSet rs = check.executeQuery()) {
                if (rs.next()) {
                    return "Duplicate NFC! This NFC card (" + serial2 + ") was already used on body serial number "
                            + rs.getString(1) + ". Cabinet not saved.";
                }
            }
        }
        return null;
    }

    private void handleSave(final String requestId, final String payloadJson) {
        executor.execute(() -> {
            JSONObject res = doSave(payloadJson);
            final String js = "window.__onNativeSaveResult && window.__onNativeSaveResult("
                    + JSONObject.quote(requestId) + "," + res + ")";
            runOnUiThread(() -> webView.evaluateJavascript(js, null));
        });
    }

    // ---------- JavaScript bridge (window.AndroidNfc) ----------
    private class Bridge {
        @JavascriptInterface
        public boolean isAvailable() { return nfcAdapter != null; }

        @JavascriptInterface
        public boolean isEnabled() { return nfcAdapter != null && nfcAdapter.isEnabled(); }

        @JavascriptInterface
        public void changeServer() { runOnUiThread(() -> showSettings()); }

        @JavascriptInterface
        public void saveCabinet(String requestId, String payloadJson) { handleSave(requestId, payloadJson); }
    }
}