#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Bidwise push notifications, native side. The app delegate makes `shared` the
 * notification-centre delegate before React starts and forwards the APNs device
 * token here; the `BidwisePush` JS module (BidwisePush.mm) reads from it.
 *
 * - Notifications arriving while the app is open are shown as banners and reported
 *   to JS as `received`.
 * - Taps are reported as `opened`. A tap that launched the app (JS not running yet)
 *   is kept for `getInitialOpen()` instead.
 * - Events sent before JS starts listening are queued and replayed.
 */
@interface BidwisePushCenter : NSObject <UNUserNotificationCenterDelegate>

@property (class, readonly, strong) BidwisePushCenter *shared;

- (void)didRegisterWithDeviceToken:(NSData *)deviceToken
    NS_SWIFT_NAME(didRegister(deviceToken:));
- (void)didFailToRegisterWithError:(NSError *)error
    NS_SWIFT_NAME(didFailToRegister(error:));

@end

NS_ASSUME_NONNULL_END
