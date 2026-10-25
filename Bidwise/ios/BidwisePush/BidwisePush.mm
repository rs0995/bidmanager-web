#import "BidwisePush.h"

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>

static NSString *const kEventToken = @"token";
static NSString *const kEventError = @"registrationError";
static NSString *const kEventReceived = @"received";
static NSString *const kEventOpened = @"opened";

@class BidwisePush;

@interface BidwisePushCenter ()
@property (nonatomic, weak, nullable) RCTEventEmitter *module;
@property (nonatomic) BOOL listening;
@property (nonatomic, copy, nullable) NSString *token;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *pending;
@property (nonatomic, copy, nullable) NSDictionary *initialOpen;
- (void)emit:(NSString *)name body:(id)body;
- (void)startListening:(RCTEventEmitter *)module;
- (void)stopListening;
@end

/** The notification's payload without the `aps` block: what the server put in `extra`,
 *  plus `thread` (the aps thread-id) so JS can tell tender / org / closing / download /
 *  captcha notifications apart. */
static NSDictionary *PayloadOf(UNNotification *notification)
{
  NSDictionary *info = notification.request.content.userInfo ?: @{};
  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  [info enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
    if ([key isKindOfClass:[NSString class]] && ![key isEqualToString:@"aps"]) {
      out[key] = obj;
    }
  }];
  NSString *thread = notification.request.content.threadIdentifier;
  if (thread.length > 0) {
    out[@"thread"] = thread;
  }
  out[@"title"] = notification.request.content.title ?: @"";
  out[@"body"] = notification.request.content.body ?: @"";
  return out;
}

@implementation BidwisePushCenter

+ (BidwisePushCenter *)shared
{
  static BidwisePushCenter *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    instance = [BidwisePushCenter new];
  });
  return instance;
}

- (instancetype)init
{
  if (self = [super init]) {
    _pending = [NSMutableArray array];
  }
  return self;
}

- (void)emit:(NSString *)name body:(id)body
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.listening && self.module) {
      [self.module sendEventWithName:name body:body];
    } else {
      [self.pending addObject:@{@"name" : name, @"body" : body ?: [NSNull null]}];
    }
  });
}

- (void)startListening:(RCTEventEmitter *)module
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self.module = module;
    self.listening = YES;
    NSArray<NSDictionary *> *queued = [self.pending copy];
    [self.pending removeAllObjects];
    for (NSDictionary *event in queued) {
      [module sendEventWithName:event[@"name"] body:event[@"body"]];
    }
  });
}

- (void)stopListening
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self.listening = NO;
  });
}

- (void)didRegisterWithDeviceToken:(NSData *)deviceToken
{
  const unsigned char *bytes = (const unsigned char *)deviceToken.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:deviceToken.length * 2];
  for (NSUInteger i = 0; i < deviceToken.length; i++) {
    [hex appendFormat:@"%02x", bytes[i]];
  }
  self.token = hex;
  [self emit:kEventToken body:@{@"token" : hex}];
}

- (void)didFailToRegisterWithError:(NSError *)error
{
  [self emit:kEventError body:@{@"message" : error.localizedDescription ?: @"Registration failed"}];
}

// A notification arrives while the app is open: show it anyway, and tell JS.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler
{
  [self emit:kEventReceived body:PayloadOf(notification)];
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList |
                    UNNotificationPresentationOptionSound | UNNotificationPresentationOptionBadge);
}

// The user tapped a notification. Before JS is listening (the tap launched the app),
// keep it for getInitialOpen() rather than queueing it, so it is handled exactly once.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler
{
  NSDictionary *payload = PayloadOf(response.notification);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.listening && self.module) {
      [self.module sendEventWithName:kEventOpened body:payload];
    } else {
      self.initialOpen = payload;
    }
  });
  completionHandler();
}

@end

@interface BidwisePush : RCTEventEmitter <RCTBridgeModule>
@end

@implementation BidwisePush

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ kEventToken, kEventError, kEventReceived, kEventOpened ];
}

- (void)startObserving
{
  [BidwisePushCenter.shared startListening:self];
}

- (void)stopObserving
{
  [BidwisePushCenter.shared stopListening];
}

RCT_EXPORT_METHOD(requestPermission
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  UNAuthorizationOptions options =
      UNAuthorizationOptionAlert | UNAuthorizationOptionBadge | UNAuthorizationOptionSound;
  [[UNUserNotificationCenter currentNotificationCenter]
      requestAuthorizationWithOptions:options
                    completionHandler:^(BOOL granted, NSError *_Nullable error) {
                      if (granted) {
                        dispatch_async(dispatch_get_main_queue(), ^{
                          [[UIApplication sharedApplication] registerForRemoteNotifications];
                        });
                      }
                      resolve(@(granted));
                    }];
}

/** "granted", "denied" or "undetermined" (never asked). */
RCT_EXPORT_METHOD(getPermissionStatus
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  [[UNUserNotificationCenter currentNotificationCenter]
      getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        switch (settings.authorizationStatus) {
          case UNAuthorizationStatusNotDetermined:
            resolve(@"undetermined");
            break;
          case UNAuthorizationStatusDenied:
            resolve(@"denied");
            break;
          default:
            resolve(@"granted");
            break;
        }
      }];
}

/** Asks APNs for this device's token (arrives as a `token` event). */
RCT_EXPORT_METHOD(register)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [[UIApplication sharedApplication] registerForRemoteNotifications];
  });
}

RCT_EXPORT_METHOD(getToken
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  resolve(BidwisePushCenter.shared.token ?: [NSNull null]);
}

/** The tap that launched the app, once (then cleared). */
RCT_EXPORT_METHOD(getInitialOpen
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *open = BidwisePushCenter.shared.initialOpen;
    BidwisePushCenter.shared.initialOpen = nil;
    resolve(open ?: [NSNull null]);
  });
}

RCT_EXPORT_METHOD(setBadge : (double)count)
{
  NSInteger n = MAX(0, (NSInteger)count);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (@available(iOS 16.0, *)) {
      [[UNUserNotificationCenter currentNotificationCenter] setBadgeCount:n withCompletionHandler:nil];
    } else {
      [UIApplication sharedApplication].applicationIconBadgeNumber = n;
    }
  });
}

/**
 * A notification from this device, shown now (lock screen, banner, sound, badge) like a
 * server push. `payload.thread` groups it and routes its tap; the rest is userInfo.
 */
RCT_EXPORT_METHOD(notify
                  : (NSString *)title body
                  : (NSString *)body payload
                  : (NSDictionary *)payload badge
                  : (double)badge)
{
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = title ?: @"";
  content.body = body ?: @"";
  content.sound = [UNNotificationSound defaultSound];
  content.badge = @(MAX(0, (NSInteger)badge));
  NSMutableDictionary *info = [NSMutableDictionary dictionary];
  [payload enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
    if ([key isKindOfClass:[NSString class]] && ![obj isKindOfClass:[NSNull class]]) {
      info[key] = obj;
    }
  }];
  content.userInfo = info;
  NSString *thread = [payload[@"thread"] isKindOfClass:[NSString class]] ? payload[@"thread"] : nil;
  if (thread.length > 0) {
    content.threadIdentifier = thread;
  }
  // No trigger: delivered right away.
  UNNotificationRequest *request =
      [UNNotificationRequest requestWithIdentifier:[NSUUID UUID].UUIDString content:content trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request
                                                         withCompletionHandler:nil];
}

@end
