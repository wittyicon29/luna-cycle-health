package app.placeholder.luna;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LauncherAppearance")
public class LauncherAppearancePlugin extends Plugin {
    private static final String[] KEYS = {"default", "notes", "planner", "journal", "checklist", "organizer"};
    private static final String[] ALIASES = {
        ".LauncherDefault", ".LauncherNotes", ".LauncherPlanner",
        ".LauncherJournal", ".LauncherChecklist", ".LauncherOrganizer"
    };

    private ComponentName component(int index) {
        return new ComponentName(getContext().getPackageName(), getContext().getPackageName() + ALIASES[index]);
    }

    private boolean isEnabled(int index) {
        int state = getContext().getPackageManager().getComponentEnabledSetting(component(index));
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        // DEFAULT means "whatever the manifest says": only the default alias is enabled there.
        return state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && index == 0;
    }

    private int currentIndex() {
        for (int i = 0; i < KEYS.length; i++) if (isEnabled(i)) return i;
        return 0;
    }

    private void setState(int index, boolean enabled) {
        getContext().getPackageManager().setComponentEnabledSetting(
            component(index),
            enabled ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP
        );
    }

    private JSObject result(int index) {
        JSObject out = new JSObject();
        out.put("appearance", KEYS[index]);
        return out;
    }

    @PluginMethod
    public void getAppearance(PluginCall call) {
        try {
            call.resolve(result(currentIndex()));
        } catch (Exception e) {
            call.resolve(result(0));
        }
    }

    @PluginMethod
    public void setAppearance(PluginCall call) {
        String requested = call.getString("appearance");
        int target = -1;
        for (int i = 0; i < KEYS.length; i++) if (KEYS[i].equals(requested)) target = i;
        if (target < 0) {
            call.reject("Unknown appearance");
            return;
        }
        int previous = currentIndex();
        try {
            setState(target, true);                       // never leave zero launcher entries
            for (int i = 0; i < KEYS.length; i++) if (i != target) setState(i, false);
            if (currentIndex() != target) throw new IllegalStateException("verify failed");
            call.resolve(result(target));
        } catch (Exception e) {
            try {
                setState(previous, true);
                for (int i = 0; i < KEYS.length; i++) if (i != previous) setState(i, false);
            } catch (Exception ignored) { /* best effort restore */ }
            call.reject("Could not change appearance");
        }
    }
}
