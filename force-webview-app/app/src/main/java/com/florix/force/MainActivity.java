package com.florix.force;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** Full-screen shell around the deployed F.O.R.C.E. dashboard. The website does all the work (live Firebase data included). */
@SuppressWarnings("deprecation")
public class MainActivity extends Activity {
    private static final String HOME = "https://force-gilt.vercel.app/";
    private static final String HOST = "force-gilt.vercel.app";
    private static final int BG = Color.parseColor("#080B14");
    private static final int ACCENT = Color.parseColor("#A855F7");

    private FrameLayout root;
    private WebView web;
    private ProgressBar bar;
    private LinearLayout offline;
    private TextView offlineMessage;

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        // Edge-to-edge on Android 15+: keep content clear of the system bars and the keyboard.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // debug builds only
        }
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " FORCE-App/1.0");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                bar.setProgress(progress);
                bar.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgressTintList(ColorStateList.valueOf(ACCENT));
        bar.setVisibility(View.GONE);
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));

        root.addView(buildOfflineScreen(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (state == null || web.restoreState(state) == null) {
            web.loadUrl(HOME);
        }
    }

    private View buildOfflineScreen() {
        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(Gravity.CENTER);
        offline.setBackgroundColor(BG);
        offline.setPadding(dp(32), dp(32), dp(32), dp(32));
        offline.setClickable(true); // swallow touches so the page underneath is not scrolled
        offline.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("Can't reach F.O.R.C.E.");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        offline.addView(title);

        offlineMessage = new TextView(this);
        offlineMessage.setTextColor(Color.parseColor("#A1A1B5"));
        offlineMessage.setTextSize(15);
        offlineMessage.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mp.topMargin = dp(8);
        offline.addView(offlineMessage, mp);

        Button retry = new Button(this);
        retry.setText("Retry");
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        retry.setTextSize(16);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(ACCENT);
        bg.setCornerRadius(dp(10));
        retry.setBackground(bg);
        retry.setMinHeight(dp(48));
        retry.setMinWidth(dp(160));
        retry.setOnClickListener(v -> retry());
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.topMargin = dp(24);
        offline.addView(retry, rp);
        return offline;
    }

    private void showOffline(String reason) {
        offlineMessage.setText(reason + "\nCheck your connection and try again.");
        offline.setVisibility(View.VISIBLE);
    }

    private void retry() {
        offline.setVisibility(View.GONE);
        String url = web.getUrl();
        if (url != null && Uri.parse(url).getHost() != null && HOST.equals(Uri.parse(url).getHost())) {
            web.reload();
        } else {
            web.loadUrl(HOME);
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
            if ("about".equals(uri.getScheme())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri)); // everything else opens in the system browser
            } catch (ActivityNotFoundException ignored) {
                // no app can open it: stay on the dashboard
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            bar.setVisibility(View.VISIBLE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline("The page could not be loaded.");
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                showOffline("The server answered with error " + response.getStatusCode() + ".");
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            recreate(); // the WebView process died (low memory): start a clean one
            return true;
        }
    }

    @Override
    public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) {
            finish();
            return;
        }
        // A dashboard tab opened through the URL hash (#real-world-impact) closes first, then normal web history, then the app.
        web.evaluateJavascript("(function(){if(location.hash){location.hash='';return 1}return 0})()", v -> {
            if ("1".equals(v)) return;
            if (web.canGoBack()) web.goBack(); else finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
