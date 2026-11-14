//! Recognising meeting apps, so Memo can offer to take notes when one starts.

use serde::Serialize;

/// A meeting app Memo knows by its macOS bundle identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct MeetingApp {
    pub bundle_id: &'static str,
    pub name: &'static str,
}

/// Desktop apps whose only job is calls. Browsers are left out: a browser
/// running is not a meeting, and Meet in a tab is recognised from the calendar.
pub const KNOWN: &[MeetingApp] = &[
    MeetingApp {
        bundle_id: "us.zoom.xos",
        name: "Zoom",
    },
    MeetingApp {
        bundle_id: "com.microsoft.teams2",
        name: "Microsoft Teams",
    },
    MeetingApp {
        bundle_id: "com.microsoft.teams",
        name: "Microsoft Teams",
    },
    MeetingApp {
        bundle_id: "com.cisco.webexmeetingsapp",
        name: "Webex",
    },
    MeetingApp {
        bundle_id: "com.apple.FaceTime",
        name: "FaceTime",
    },
    MeetingApp {
        bundle_id: "com.tinyspeck.slackmacgap",
        name: "Slack",
    },
    MeetingApp {
        bundle_id: "com.hnc.Discord",
        name: "Discord",
    },
    MeetingApp {
        bundle_id: "com.around.Around",
        name: "Around",
    },
];

/// The meeting app with this bundle id, if Memo knows it. Case-insensitive,
/// because bundle ids reported by different APIs disagree on case.
pub fn identify(bundle_id: &str) -> Option<MeetingApp> {
    let wanted = bundle_id.trim();
    KNOWN
        .iter()
        .copied()
        .find(|app| app.bundle_id.eq_ignore_ascii_case(wanted))
}

/// The call link in a calendar event's location or notes, if there is one.
pub fn call_link(text: &str) -> Option<&str> {
    const HOSTS: &[&str] = &[
        "meet.google.com/",
        "zoom.us/j/",
        "zoom.us/my/",
        "teams.microsoft.com/l/meetup-join",
        "teams.live.com/meet/",
        "webex.com/meet/",
        "facetime.apple.com/join",
    ];
    text.split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '(' | ')'))
        .map(|word| word.trim_end_matches(['.', ',', ';']))
        .find(|word| {
            (word.starts_with("https://") || word.starts_with("http://"))
                && HOSTS.iter().any(|host| word.contains(host))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_known_apps_case_insensitively() {
        assert_eq!(identify("us.zoom.xos").unwrap().name, "Zoom");
        assert_eq!(identify(" COM.APPLE.FACETIME ").unwrap().name, "FaceTime");
        assert_eq!(identify("com.google.Chrome"), None);
    }

    #[test]
    fn finds_the_call_link_in_event_text() {
        let notes = "Agenda below.\nJoin: <https://meet.google.com/abc-defg-hij>, or dial in.";
        assert_eq!(
            call_link(notes),
            Some("https://meet.google.com/abc-defg-hij")
        );
        assert_eq!(
            call_link("https://acme.zoom.us/j/123456789?pwd=x."),
            Some("https://acme.zoom.us/j/123456789?pwd=x")
        );
        assert_eq!(call_link("Room 4B, https://example.com/meet"), None);
    }
}
