package com.yuanziyuan.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 极简 FileProvider。
 *
 * 为什么需要它：导出文件在「应用专属目录」里时是 file:// 形式，而 Android 7(API 24)+ 明确禁止
 * 把 file:// 通过 Intent 传给别的应用（会抛 FileUriExposedException）——「用其他应用打开」因此失效。
 * 本 Provider 把该目录暴露成 content://com.yuanziyuan.app.files/<文件名>，
 * 再由调用方加 FLAG_GRANT_READ_URI_PERMISSION 授予临时读权限即可正常打开。
 *
 * 安全：只暴露 base 目录下的**单层**文件，拒绝含路径分隔符或 .. 的名字（防目录穿越）。
 */
public class ExportProvider extends ContentProvider {

    public static final String AUTHORITY = "com.yuanziyuan.app.files";

    public static Uri uriFor(String name) {
        return Uri.parse("content://" + AUTHORITY + "/" + Uri.encode(name == null ? "" : name));
    }

    /** 分享用的出口：content://authority/share/<名字>，文件在 cache/share 下。
     *  与「导出」分开，是因为分享是临时动作，不该写进用户的下载目录。 */
    public static Uri uriForShare(String name) {
        return Uri.parse("content://" + AUTHORITY + "/share/" + Uri.encode(name == null ? "" : name));
    }

    private File shareBase() {
        File d = new File(getContext().getCacheDir(), "share");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    @Override public boolean onCreate() { return true; }

    /** 与应用导出使用同一个目录：getExternalFilesDir(DIRECTORY_DOWNLOADS)，兜底到内部 files/export */
    private File base() {
        File d = null;
        try { d = getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS); } catch (Throwable t) {}
        if (d == null) d = new File(getContext().getFilesDir(), "export");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** 解析为文件；只允许 base 下的单层文件；路径 /share/x 走 cache/share */
    private File resolve(Uri uri) {
        java.util.List<String> segs = uri.getPathSegments();
        if (segs == null || segs.isEmpty() || segs.size() > 2) return null;
        boolean isShare = segs.size() == 2 && "share".equals(segs.get(0));
        String name = segs.get(segs.size() - 1);
        if (name == null) return null;
        try { name = Uri.decode(name); } catch (Throwable t) { /* 保持原样 */ }
        if (name.length() == 0 || name.length() > 200) return null;
        if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return null;
        if (name.equals(".") || name.equals("..") || name.contains("..")) return null;
        return new File(isShare ? shareBase() : base(), name);
    }

    @Override public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        if (n == null) return "application/octet-stream";
        int i = n.lastIndexOf('.');
        String ext = (i >= 0) ? n.substring(i + 1).toLowerCase() : "";
        String m = null;
        try { m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext); } catch (Throwable t) {}
        return (m == null || m.length() == 0) ? "application/octet-stream" : m;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolve(uri);
        if (f == null || !f.isFile()) throw new FileNotFoundException("文件不存在");
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
